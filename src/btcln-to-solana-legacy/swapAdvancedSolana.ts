import {solanaRpc, swapper, Tokens} from "../setup";
import {FeeType, FromBTCLNSwapState, SwapAmountType} from "@atomiqlabs/sdk";
import {solanaWallet} from "../wallets";


//Swap BTC L2 lightning network to Solana assets (uses old, legacy swap protocol)
async function main() {
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
        undefined, //Source address for the swap, not used for swaps from BTC-LN
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

    //1. Pay the invoice as specified in `swap.getAddress()` from an external LN wallet
    console.log("Pay the provided lightning network invoice from external lightning network wallet: ", swap.getAddress());

    //2. Start listening to incoming lightning network payment
    const success = await swap.waitForPayment();
    if(!success) {
        console.log("Lightning network payment not received in time and quote expired!");
        return;
    }

    //3. Claim the swap at the destination
    console.log("Lightning payment received, claiming now!");
    //a. you can either use a simple swap.commitAndClaim()
    // await swap.commitAndClaim(solanaWallet);
    //b. or you can obtain the required transactions and sign & broadcast them manually, be careful to wait for 1st
    // transaction to confirm before you send the next one, this is important to ensure security of the swap!
    const txsCommitAndClaim = await swap.txsCommitAndClaim();
    for(let tx of txsCommitAndClaim) {
        tx.tx.recentBlockhash ??= (await solanaRpc.getLatestBlockhash()).blockhash;
        const signedTx = await solanaWallet.signTransaction(tx.tx);
        if(tx.signers.length>0) signedTx.sign(...tx.signers);
        const signature = await solanaRpc.sendRawTransaction(signedTx.serialize());
        await solanaRpc.confirmTransaction(signature, "confirmed");
    }
    console.log("Successfully claimed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
