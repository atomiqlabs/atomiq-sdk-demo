import {FeeType, FromBTCSwapState, SwapAmountType} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {solanaRpc, swapper, Tokens} from "../setup";
import {bitcoinWallet, solanaWallet} from "../wallets";

//Swap BTC on-chain to Solana assets (uses old, legacy swap protocol)
async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const dstToken = Tokens.SOLANA.SOL;

    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTC, //Swap from BTC
        dstToken, //Into specified destination token
        2000n, //2000 sats (0.00002 BTC)
        SwapAmountType.EXACT_IN, //Whether we define an input or output amount
        undefined, //Source address for the swap, not used for swaps from BTC
        solanaWallet.publicKey.toString() //Destination address
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
    console.log("   Bitcoin swap address expiry: "+swap.getTimeoutTime()+" (in "+(swap.getTimeoutTime()-Date.now())/1000+" seconds)"); //Expiration of the opened up bitcoin swap address, no funds should be sent after this time!
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Refundable deposit: "+swap.getSecurityDeposit()); //Refundable deposit on the destination chain, this will be taken when user creates the swap and refunded when user finishes it
    console.log("   Watchtower fee: "+swap.getClaimerBounty()); //Fee pre-funded on the destination chain, this will be used as a fee for watchtower to automatically claim the swap on the destination on behalf of the user

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCSwapState[swap.getState()]);
    });

    await askQuestion("Press ENTER to execute the swap...");

    //1. Initiate the swap on the destination chain (Solana) by opening up the bitcoin swap address
    console.log("Opening swap address...");
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
    console.log("Swap address opened!");

    //2a. Obtain the funded PSBT (inputs already added) - ready for signing
    const {psbt, psbtHex, psbtBase64, signInputs} = await swap.getFundedPsbt({
        address: bitcoinWallet.address,
        publicKey: Buffer.from(bitcoinWallet.pubkey).toString("hex")
    });
    for(let signIdx of signInputs) {
        psbt.signIdx(bitcoinWallet.privKey, signIdx); //Or pass it to external signer
    }
    const bitcoinTxId = await swap.submitPsbt(psbt);
    console.log(`Bitcoin transaction sent: ${bitcoinTxId}`)

    //2b. Or just get the bitcoin address to send the funds to and send the funds there
    // extra care needs to be taken to send EXACTLY the amount requested, sending different amounts
    // might lead to loss of funds
    // const btcSwapAddress = swap.getAddress();
    // console.log("Bitcoin swap address (send EXACT funds here)");

    //3. Wait for the bitcoin on-chain transaction to confirm
    await swap.waitForBitcoinTransaction(
        (txId, confirmations, targetConfirmations, txEtaMs) => {
            if(txId==null) return;
            console.log("Swap transaction "+txId+" ("+confirmations+"/"+targetConfirmations+") ETA: "+(txEtaMs/1000)+"s");
        }
    );

    //4. Wait for the automatic settlement of the swap
    const automaticSettlementSuccess = await swap.waitTillClaimed(30);

    //In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
    if(!automaticSettlementSuccess) {
        console.log("Swap not claimed by watchtowers, claiming manually!");
        //5. In case the swap is not automatically settled, we can settle manually by sending claim transaction on the destination
        //a. you can either use a simple swap.claim()
        // await swap.claim(solanaWallet);
        //b. or you can obtain the required transactions and sign & broadcast them manually
        const txsClaim = await swap.txsClaim(solanaWallet);
        for(let tx of txsClaim) {
            tx.tx.recentBlockhash ??= (await solanaRpc.getLatestBlockhash()).blockhash;
            const signedTx = await solanaWallet.signTransaction(tx.tx);
            if(tx.signers.length>0) signedTx.sign(...tx.signers);
            await solanaRpc.sendRawTransaction(signedTx.serialize());
        }
    }
    console.log("Successfully claimed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
