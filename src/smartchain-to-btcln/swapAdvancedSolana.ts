import {FeeType, SwapAmountType, ToBTCSwapState} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {solanaRpc, swapper, Tokens} from "../setup";
import {solanaWallet} from "../wallets";

//Swap of Solana assets to Bitcoin L2 lightning network
//This uses an external lightning network wallet, so you need to pass the bitcoin lightning network invoice
// to be paid via the command line argument
async function main() {
    //Load the lightning network invoice from the command line argument
    const lightningInvoice = process.argv[2];
    //We can also check that it is a valid LN invoice
    if(!swapper.Utils.isValidLightningInvoice(lightningInvoice)) throw new Error("Invalid lightning network invoice in cmd parameters");

    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const srcToken = Tokens.SOLANA.SOL;

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
        solanaWallet.publicKey.toString(), //Source address and smart chain signer
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

    //1. Initiate the swap on the smart-chain side
    //a. you can either use a simple swap.commit()
    // await swap.commit(solanaWallet);
    //b. or you can obtain the required transactions and sign & broadcast them manually
    const txsCommit = await swap.txsCommit();
    for(let tx of txsCommit) {
        tx.tx.recentBlockhash ??= (await solanaRpc.getLatestBlockhash()).blockhash;
        const signedTx = await solanaWallet.signTransaction(tx.tx);
        if(tx.signers.length>0) signedTx.sign(...tx.signers);
        await solanaRpc.sendRawTransaction(signedTx.serialize());
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
        // await swap.refund(solanaWallet);
        //b. or you can obtain the required transactions and sign & broadcast them manually
        const txsRefund = await swap.txsRefund();
        for(let tx of txsRefund) {
            tx.tx.recentBlockhash ??= (await solanaRpc.getLatestBlockhash()).blockhash;
            const signedTx = await solanaWallet.signTransaction(tx.tx);
            if(tx.signers.length>0) signedTx.sign(...tx.signers);
            await solanaRpc.sendRawTransaction(signedTx.serialize());
        }
        console.log("Swap failed and refunded!");
        return;
    }

    //Swap was successful, we can retrieve lightning network payment proof (hash pre-image)
    console.log("Successfully swapped to LN, payment proof: "+swap.getSecret());

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
