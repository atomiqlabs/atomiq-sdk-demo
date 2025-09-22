import {swapper, Tokens} from "../setup";
import {FeeType, FromBTCLNAutoSwapState, SwapAmountType} from "@atomiqlabs/sdk";
import {starknetWallet} from "../wallets";


//Swap of on-chain BTC -> Starknet assets (uses new swap protocol - not available on Solana)
async function main() {
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
        undefined, //Source address for the swap, not used for swaps from BTC-LN
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

    console.log("Waiting for the manual payment of the lightning network invoice (pay it from your lightning network wallet)...");

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCLNAutoSwapState[swap.getState()]);
    });

    //1. Pay the invoice as specified in `swap.getAddress()` from an external LN wallet
    console.log("Pay the provided lightning network invoice from external lightning network wallet: ", swap.getAddress());

    //2. Start listening to incoming lightning network payment
    const success = await swap.waitForPayment();
    if(!success) {
        console.log("Lightning network payment not received in time and quote expired!");
        return;
    }

    //3. Wait for the swap to be automatically settled
    const automaticSettlementSuccess = await swap.waitTillClaimed(60);

    //In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
    if(!automaticSettlementSuccess) {
        console.log("Swap not claimed by watchtowers, claiming manually!");
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
    console.log("Successfully claimed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
