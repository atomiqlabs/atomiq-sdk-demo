import {swapper, Tokens} from "../setup";
import {FeeType, FromBTCLNSwapState, SwapAmountType} from "@atomiqlabs/sdk";
import {solanaWallet} from "../wallets";
import {askQuestion} from "../askQuestion";


//Swap BTC L2 lightning network to Solana assets (uses old, legacy swap protocol)
//This uses the LNURL-withdraw link provided in the arguments to fund the swap on the lightning network side
async function main() {
    //Load the lightning network invoice from the command line argument
    const lnurlWithdraw = process.argv[2];
    //We can also check that it is a valid LNNURL-pay link
    if(!swapper.Utils.isValidLNURL(lnurlWithdraw)) throw new Error("Invalid LNURL in cmd parameters");

    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const dstToken = Tokens.SOLANA.SOL;
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTCLN, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
        dstToken, //Into specified destination token
        "0.00001", //1000 sats (0.00001 BTC)
        SwapAmountType.EXACT_IN, //Whether we define an input or output amount
        lnurlWithdraw, //Source - LNURL-withdraw link
        solanaWallet.publicKey.toString(), //Destination address
    );

    //Relevant data about the created swap
    console.log("Swap created "+swap.getId()+":");
    console.log("   Estimated transaction fee: "+await swap.getSmartChainNetworkFee()); //Estimate of the on-chain gas fee paid
    console.log("   Input: "+swap.getInputWithoutFee()); //Input amount excluding fees
    console.log("   Fees: "+swap.getFee().amountInSrcToken); //Fees paid on the output
    for(let fee of swap.getFeeBreakdown()) {
        console.log("       - "+FeeType[fee.type]+": "+fee.fee.amountInSrcToken);
    }
    console.log("   Input with fees: "+swap.getInput()); //Total amount paid including fees
    console.log("   Output: "+swap.getOutput()); //Output amount
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Refundable deposit: "+swap.getSecurityDeposit()); //Refundable deposit on the destination chain, this will be taken when user commits and refunded when user claims
    console.log("   Address: "+swap.getAddress()); //Address/lightning network invoice to pay
    console.log("   Hyperlink: "+swap.getHyperlink()); //Hyperlink representation of the address/lightning network invoice

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCLNSwapState[swap.getState()]);
    });

    await askQuestion("Press ENTER to execute the swap...");

    await swap.execute(
        solanaWallet,
        undefined, //No need to specify any wallet, as the LNURL-withdraw link is used as a source
        {
            onSourceTransactionReceived: (sourceLnPaymentHash: string) => {
                console.log(`Lightning network transaction received by the LP: ${sourceLnPaymentHash}`);
            },
            onDestinationCommitSent: (destinationCommitTxId: string) => {
                console.log(`Commit transaction sent (HTLC creation) txId: ${destinationCommitTxId}`);
            },
            onDestinationClaimSent: (destinationClaimTxId: string) => {
                console.log(`Claim transaction sent (HTLC claiming) txId: ${destinationClaimTxId}`);
            },
            onSwapSettled: (destinationClaimTxId: string) => {
                console.log(`Swap settled, destination txId: ${destinationClaimTxId}`);
            }
        }
    );

    console.log("Successfully claimed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
