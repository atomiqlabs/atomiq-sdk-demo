import {FeeType, SwapAmountType, ToBTCSwapState} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {swapper, Tokens} from "../setup";
import {bitcoinWallet, starknetWallet} from "../wallets";

//Swap of Starknet tokens to Bitcoin L1 native BTC
async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const srcToken = Tokens.STARKNET.STRK;

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
        starknetWallet.address, //Source address and smart chain signer
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

    //1. Initiate the swap on the smart-chain side
    //a. you can either use a simple swap.commit()
    // await swap.commit(starknetWallet);
    //b. or you can obtain the required transactions and sign & broadcast them manually
    const txsCommit = await swap.txsCommit();
    for(let tx of txsCommit) {
        if(tx.type==="INVOKE") await starknetWallet.execute(tx.tx, tx.details);
        if(tx.type==="DEPLOY_ACCOUNT") await starknetWallet.deployAccount(tx.tx, tx.details);
    }
    //Important to wait till SDK processes the swap initialization
    await swap.waitTillCommited();

    //2. Wait for the swap to execute and for the payment to be sent
    const swapSuccessful = await swap.waitForPayment();

    //3. In case the swap fails we can refund our funds on the source chain
    if(!swapSuccessful) {
        //Swap failed, we can refund now
        console.log("Swap failed, refunding back to ourselves!");
        //a. you can either use a simple swap.refund()
        // await swap.refund(starknetWallet);
        //b. or you can obtain the required transactions and sign & broadcast them manually
        const txsRefund = await swap.txsRefund();
        for(let tx of txsRefund) {
            if(tx.type==="INVOKE") await starknetWallet.execute(tx.tx, tx.details);
            if(tx.type==="DEPLOY_ACCOUNT") await starknetWallet.deployAccount(tx.tx, tx.details);
        }
        console.log("Swap failed and refunded!");
        return;
    }

    //Swap was successful, we can retrieve the bitcoin transaction ID of the swap payout
    console.log("Successfully swapped to BTC L1, bitcoin txId: "+swap.getOutputTxId());

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
