import {
    FeeType,
    SpvFromBTCSwapState,
    SwapAmountType
} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {swapper, Tokens} from "../setup";
import {bitcoinWallet, starknetWallet} from "../wallets";

//Swap of on-chain BTC -> Starknet assets (uses new swap protocol - not available on Solana)
async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const dstToken = Tokens.STARKNET.STRK;

    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTC, //Swap from BTC
        dstToken, //Into specified destination token
        "0.00003", //3000 sats (0.00003 BTC)
        SwapAmountType.EXACT_IN, //Whether we define an input or output amount
        undefined, //Source address for the swap, not used for swaps from BTC
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
    console.log("   Minimum bitcoin transaction fee rate: "+swap.minimumBtcFeeRate+" sats/vB"); //Minimum fee rate of the bitcoin transaction

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", SpvFromBTCSwapState[swap.getState()]);
    });

    await askQuestion("Press ENTER to execute the swap...");

    //1a. Obtain the funded PSBT (input already added) - ready for signing
    const {psbt, psbtHex, psbtBase64, signInputs} = await swap.getFundedPsbt({
        address: bitcoinWallet.address,
        publicKey: Buffer.from(bitcoinWallet.pubkey).toString("hex")
    });
    for(let signIdx of signInputs) psbt.signIdx(bitcoinWallet.privKey, signIdx); //Or pass it to external signer
    const bitcoinTxId = await swap.submitPsbt(psbt);

    //1b. Or obtain raw PSBT to which inputs still need to be added
    // const {psbt, psbtHex, psbtBase64, in1sequence} = await swap.getPsbt();
    // psbt.addInput(...);
    // //Make sure the second input's sequence (index 1) is as specified in the in1sequence variable
    // psbt.updateInput(1, {sequence: in1sequence});
    // //Sign the PSBT (sign every input except the first one)
    // for(let i=1;i<psbt.inputsLength; i++) psbt.signIdx(..., i); //Or pass it to external signer
    // //Submit the signed PSBT
    // const bitcoinTxId = await swap.submitPsbt(psbt);
    console.log(`Bitcoin transaction sent: ${bitcoinTxId}`);

    //2. Wait for the bitcoin on-chain transaction to confirm
    await swap.waitForBitcoinTransaction(
        (txId, confirmations, targetConfirmations, txEtaMs) => {
            if(txId==null) return;
            console.log("Swap transaction "+txId+" ("+confirmations+"/"+targetConfirmations+") ETA: "+(txEtaMs/1000)+"s");
        }
    );
    console.log(`Bitcoin transaction confirmed: ${bitcoinTxId}`);

    //3. Wait for the automatic settlement of the swap
    const automaticSettlementSuccess = await swap.waitTillClaimedOrFronted(60);

    //In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
    if(!automaticSettlementSuccess) {
        console.log("Swap not automatically settled by watchtowers, claiming manually!");
        //4. In case the swap is not automatically settled, we can settle manually by sending claim transaction on the destination
        //a. you can either use a simple swap.claim()
        // await swap.claim(starknetWallet);
        //b. or you can obtain the required transactions and sign & broadcast them manually
        const txns = await swap.txsClaim(starknetWallet);
        //Execute the transaction through the wallet (you can also execute them in other ways - e.g. use paymaster, etc.)
        for(let tx of txns) {
            if(tx.type==="INVOKE") await starknetWallet.execute(tx.tx, tx.details);
            if(tx.type==="DEPLOY_ACCOUNT") await starknetWallet.deployAccount(tx.tx, tx.details);
        }
    }
    console.log("Swap successfully executed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
