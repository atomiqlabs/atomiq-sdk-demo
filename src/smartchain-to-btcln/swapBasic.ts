import {FeeType, SwapAmountType, ToBTCSwapState} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {swapper, Tokens} from "../setup";
import {starknetWallet} from "../wallets";

//Swap of smart chain tokens (Starknet, Solana, etc.) to Bitcoin L2 lightning network
//This uses an external lightning network wallet, so you need to pass the bitcoin lightning network invoice
// to be paid via the command line argument
//This uses the same flow for all supported chains: Starknet, Solana & EVM
async function main() {
    //Load the lightning network invoice from the command line argument
    const lightningInvoice = process.argv[2];
    //We can also check that it is a valid LN invoice
    if(!swapper.Utils.isValidLightningInvoice(lightningInvoice)) throw new Error("Invalid lightning network invoice in cmd parameters");

    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const srcToken = Tokens.STARKNET.STRK;

    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(srcToken, Tokens.BITCOIN.BTCLN);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Available after swap rejected due to too high/low amounts
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Immediately available

    //Create swap quote
    const swap = await swapper.swap(
        srcToken, //From specified source token
        Tokens.BITCOIN.BTCLN, //Swap to BTC-LN
        undefined, //Amount is specified in the lightning network invoice!
        SwapAmountType.EXACT_OUT, //Make sure we use EXACT_OUT for swaps to BTC-LN, if you want to use exactIn=true and set an amount, use LNURL-pay!
        starknetWallet.address, //Source address and smart chain signer
        lightningInvoice //Destination of the swap
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
    console.log("   Is paying to non-custodial wallet: "+swap.isPayingToNonCustodialWallet()); //Whether the payment is likely being made to non-custodial lightning network wallet, it is important for the destination wallet to be online!
    console.log("   Is likely to fail: "+swap.willLikelyFail()); //Whether the lightning network payment is likely to fail (probing on the lightning network failed, but route exists)

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", ToBTCSwapState[swap.getState()]);
    });

    await askQuestion("Press ENTER to execute the swap...");

    //The easiest way to execute a swap by passing a wallet/signer and adding optional callbacks & options
    const swapSuccessful = await swap.execute(starknetWallet, {
        onSourceTransactionSent: (txId: string) => {
            console.log(`Source transaction sent, txId: ${txId}`);
        },
        onSourceTransactionConfirmed: (txId: string) => {
            console.log(`Source transaction confirmed, txId: ${txId}`)
        },
        onSwapSettled: (destinationTxId: string) => {
            console.log(`Swap settled, lightning network destination txId: ${destinationTxId}`);
        }
    });

    //In case the swap fails we can refund our funds on the source chain
    if(!swapSuccessful) {
        //Swap failed, we can refund now
        console.log("Swap failed, refunding back to ourselves!");
        await swap.refund(starknetWallet);
        console.log("Swap failed and refunded!");
        return;
    }

    //Swap was successful, we can retrieve lightning network payment proof (hash pre-image)
    console.log("Successfully swapped to LN, payment proof: "+swap.getSecret());

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
