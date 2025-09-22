import {FeeType, SpvFromBTCSwapState, SwapAmountType} from "@atomiqlabs/sdk";
import {askQuestion} from "../askQuestion";
import {swapper, Tokens} from "../setup";
import {bitcoinWallet, starknetWallet} from "../wallets";

//Swap of on-chain BTC -> Starknet/EVM assets (uses new swap protocol - not available on Solana)
//Simple flow is same for both Starknet & EVM
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

    //The easiest way to execute a swap - pass a btc wallet object and add optional callbacks/options
    const automaticSettlementSuccess = await swap.execute({
        //Pass the address and public key of the wallet
        address: bitcoinWallet.address,
        publicKey: Buffer.from(bitcoinWallet.pubkey).toString("hex"),
        //And a callback function for signing PSBTs, the SDK will pass the psbt as @scure/btc-signer Transaction object,
        // and in string hex and base64 form, so you can easily use it with existing wallet APIs
        signPsbt: (psbt: {psbt, psbtHex: string, psbtBase64: string}, signInputs: number[]) => {
            return bitcoinWallet.signPsbt(psbt.psbt, signInputs);
        }
    }, {
        onSourceTransactionSent: (txId) => {
            console.log(`Bitcoin transaction sent: ${txId}`)
        },
        onSourceTransactionConfirmationStatus: (txId, confirmations, targetConfirmations, txEtaMs) => {
            console.log(`Bitcoin transaction ${txId} (${confirmations}/${targetConfirmations} confirmations) ETA: ${txEtaMs/1000}s`);
        },
        onSourceTransactionConfirmed: (txId) => {
            console.log(`Bitcoin transaction confirmed: ${txId}, waiting for automatic settlement by watchtowers...`)
        },
        onSwapSettled: (txId) => {
            console.log(`Swap settled, destination transaction: ${txId}`)
        }
    });

    //In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
    if(!automaticSettlementSuccess) {
        console.log("Swap not automatically settled by watchtowers, claiming manually!");
        await swap.claim(starknetWallet);
    }
    console.log("Swap successfully executed!");

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}

main();
