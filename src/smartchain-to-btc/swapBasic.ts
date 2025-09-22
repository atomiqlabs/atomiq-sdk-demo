import {FeeType, SwapAmountType, ToBTCSwapState} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {swapper, Tokens} from "../setup";
import {bitcoinWallet, solanaWallet} from "../wallets";

//Swap of smart chain tokens (Starknet, Solana, etc.) to Bitcoin L1 native BTC
//This uses the same flow for all supported chains: Starknet, Solana & EVM
async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const srcToken = Tokens.SOLANA.SOL;

    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(srcToken, Tokens.BITCOIN.BTC);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Available after swap rejected due to too high/low amounts
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Immediately available

    //Create swap quote
    const swap = await swapper.swap(
        srcToken, //From specified source token
        Tokens.BITCOIN.BTC, //Swap to BTC
        "0.00003", //Amount of the BTC to send, you can either input decimal number as string, or base units as bigint
        SwapAmountType.EXACT_OUT, //We want to specify amount in output token (BTC)
        solanaWallet.publicKey.toString(), //Source address and smart chain signer
        bitcoinWallet.address, //Destination of the swap
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
    console.log("   Bitcoin transaction fee rate: "+swap.getBitcoinFeeRate()+" sats/vB"); //

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", ToBTCSwapState[swap.getState()]);
    });

    await askQuestion("Press ENTER to execute the swap...");

    //The easiest way to execute a swap by passing a wallet/signer and adding optional callbacks & options
    const swapSuccessful = await swap.execute(solanaWallet, {
        onSourceTransactionSent: (txId: string) => {
            console.log(`Source transaction sent, txId: ${txId}`);
        },
        onSourceTransactionConfirmed: (txId: string) => {
            console.log(`Source transaction confirmed, txId: ${txId}`)
        },
        onSwapSettled: (destinationTxId: string) => {
            console.log(`Swap settled, bitcoin destination txId: ${destinationTxId}`);
        }
    });

    //In case the swap fails we can refund our funds on the source chain
    if(!swapSuccessful) {
        //Swap failed, we can refund now
        console.log("Swap failed, refunding back to ourselves!");
        await swap.refund(solanaWallet);
        console.log("Swap failed and refunded!");
        return;
    }

    //Swap was successful, we can retrieve the bitcoin transaction ID of the swap payout
    console.log("Successfully swapped to BTC L1, bitcoin txId: "+swap.getOutputTxId());

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
