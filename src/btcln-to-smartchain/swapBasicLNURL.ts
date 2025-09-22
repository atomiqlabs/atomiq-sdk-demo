import {swapper, Tokens} from "../setup";
import {FeeType, FromBTCLNAutoSwapState, SwapAmountType} from "@atomiqlabs/sdk";
import {starknetWallet} from "../wallets";
import {askQuestion} from "../askQuestion";


//Swap of BTC L2 lightning network -> Starknet/EVM assets (uses new swap protocol - not available on Solana)
//This uses the LNURL-withdraw link provided in the arguments to fund the swap on the lightning network side
//Simple flow is same for both Starknet & EVM
async function main() {
    //Load the lightning network invoice from the command line argument
    const lnurlWithdraw = process.argv[2];
    //We can also check that it is a valid LNNURL-pay link
    if(!swapper.Utils.isValidLNURL(lnurlWithdraw)) throw new Error("Invalid LNURL in cmd parameters");

    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const dstToken = Tokens.STARKNET.STRK;

    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTCLN, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
        dstToken, //Into specified destination token
        3000n, //3000 sats (0.00003 BTC)
        SwapAmountType.EXACT_IN, //Whether we define an input or output amount
        lnurlWithdraw, //Source - LNURL-withdraw link
        starknetWallet.address, //Destination address
        {
            gasAmount: 0n //We can also request a gas drop on the destination chain
        }
    );

    //Relevant data about the created swap
    console.log("Swap created "+swap.getId()+":");
    console.log("   Input: "+swap.getInputWithoutFee()); //Input amount excluding fees
    console.log("   Fees: "+swap.getFee().amountInSrcToken); //Fees paid on the output
    for(let fee of swap.getFeeBreakdown()) {
        console.log("       - "+FeeType[fee.type]+": "+fee.fee.amountInSrcToken);
    }
    console.log("   Input with fees: "+swap.getInput()); //Total amount paid including fees
    console.log("   Output: "+swap.getOutput()); //Output amount
    console.log("   Gas drop output: "+swap.getGasDropOutput()); //Output amount
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Address: "+swap.getAddress()); //Address/lightning network invoice to pay
    console.log("   Hyperlink: "+swap.getHyperlink()); //Hyperlink representation of the address/lightning network invoice

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCLNAutoSwapState[swap.getState()]);
    });

    await askQuestion("Press ENTER to execute the swap...");

    const automaticSettlementSuccess = await swap.execute(
        undefined, //No need to specify any wallet, as the LNURL-withdraw link is used as a source
        {
            onSourceTransactionReceived: (txId) => {
                console.log(`Lightning network transaction received by the LP: ${txId}`);
            },
            onSwapSettled: (destinationTxId) => {
                console.log(`Swap settled, destination txId: ${destinationTxId}`);
            }
        }
    );

    //In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
    if(!automaticSettlementSuccess) {
        console.log("Swap not claimed by watchtowers, claiming manually!");
        await swap.claim(starknetWallet);
    }
    console.log("Successfully claimed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
