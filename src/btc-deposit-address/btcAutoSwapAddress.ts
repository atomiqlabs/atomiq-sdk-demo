import {swapper, Tokens} from "../setup";
import {
    BitcoinWalletUtxo,
    FeeType,
    SpvFromBTCSwap
} from "@atomiqlabs/sdk";
import {evmWallet, bitcoinWallet} from "../wallets";

//Uses a `SingleAddressBitcoinWallet` to provide the user with a static deposit Bitcoin address. All BTC sent to this
// address will be automatically swapped to a specific destination chain token. This code uses a pre-initialized
// `bitcoinWallet` from `../wallets`, which uses a private key persisted on the file system, but you can also create
// the `SingleAddressBitcoinWallet` from mnemonic phrase or WIF.
//Creating the bitcoin wallet from mnemonic phrase:
// const bitcoinWallet: SingleAddressBitcoinWallet = new SingleAddressBitcoinWallet(
//     swapper._bitcoinRpc, swapper.Utils.bitcoinNetwork,
//     await SingleAddressBitcoinWallet.mnemonicToPrivateKey("damage damage damage damage damage damage damage damage damage damage damage damage", swapper.Utils.bitcoinNetwork)
// );
async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    const dstToken = Tokens.CITREA.CBTC;

    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    console.log("\n-----\nAwaiting BTC deposits on: "+bitcoinWallet.getReceiveAddress()+"\n-----\n")

    //Start continuously checking the balance on the deposit address
    let count = 0;
    while(true) {
        //Wait 30s before checking again
        if(count++ > 0) await new Promise(resolve => setTimeout(resolve, 30*1000));

        //Use a try-catch block here to not break the loop on any intermittent errors
        try {
            console.log(await bitcoinWallet.getUtxoPool());

            //Check if there is any balance held by the bitcoin wallet, here we check spendable balance, which is balance
            // minus whatever fees are required to execute the swap transaction
            const {balance, feeRate} = await swapper.Utils.getBitcoinSpendableBalance(bitcoinWallet, dstToken.chainId, {feeRate: 8});
            //Returns the available balance for swaps specifically to the destination chain, and a bitcoin fee rate in
            // sats/vB at which the spendable balance was calculated (higher fee rate means less spendable balance)
            console.log("Balance: ", balance.rawAmount);
            console.log("Fee rate: ", feeRate);

            //Only attempt the swap if the balance is above the minimum swap limit
            if(balance.rawAmount < swapper.getSwapLimits(Tokens.BITCOIN.BTC, dstToken).input.min.rawAmount) continue;
            //You can also additionally specify a minimum that you want to swap, this might make sense, since for smaller
            // swap sizes the proportional fee will always be larger (since the network fees are the same regardless of the
            // swap size)

            //Create the swap through the special `sweepBitcoinWallet` function, which also returns the utxos and btcFeeRate
            // that has to be used when later executing the swap, be sure to use the returned btcFeeRate, since the passed
            // `bitcoinFeeRate` in options might get overridden if the LP requires higher fee rate.
            const {swap, utxos, btcFeeRate} = await swapper.sweepBitcoinWallet(
                bitcoinWallet,
                dstToken, //Into specified destination token
                evmWallet.address, //Destination address
                {
                    bitcoinFeeRate: feeRate
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

            console.log("\n-----");
            console.log(`Executing swap of ${swap.getInput()} -> ${swap.getOutput()}`);
            console.log("-----\n");

            //Delegate swap processing to a separate function, which's promise we don't await, such that
            // this doesn't block the main loop and we can execute multiple swaps in parallel if needed
            processSwap(swap, btcFeeRate, utxos)
                .then(result => {
                    if(result) {
                        console.log("\n-----");
                        console.log(`Successfully swapped ${swap.getInput()} -> ${swap.getOutput()}!`);
                        console.log("-----\n");
                    } else {
                        console.log("\n-----");
                        console.log(`Swap of ${swap.getInput()} -> ${swap.getOutput()} has failed!`);
                        console.log("-----\n");
                    }
                })
                .catch(e => console.error("Failed to execute swap", e));
        } catch (e) {
            console.error("Failed to check the deposit address and create the swap: ", e);
        }
    }
}

//Execute the swap in separate function such that it doesn't block the main loop, this ensures that there can be
// multiple swaps happening at the same time! This also properly handles edge-cases where the `execute()` function
// throws an error and it then retries indefinitely to ensure the swap is finished.
async function processSwap(swap: SpvFromBTCSwap<any>, btcFeeRate: number, utxos: BitcoinWalletUtxo[]): Promise<boolean> {
    //The easiest way to execute a swap - pass a btc wallet and the btcFeeRate and utxos returned from the swap creation
    // function in the options, along with specifying spendFully as `true`
    let automaticSettlementSuccess: boolean;
    try {
        automaticSettlementSuccess = await swap.execute(bitcoinWallet, {
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
        }, {
            //IMPORTANT to pass the options here!
            feeRate: btcFeeRate,
            utxos: utxos,
            spendFully: true
        });
    } catch (e) {
        //Here we also handle the edge where the swap.execute() fails during execution
        //Swap already finished, return the success state of the swap
        if(swap.isFinished()) return swap.isSuccessful();
        //Just throw the returned error if the swap isn't in-progress
        if(!swap.isInProgress()) throw e;

        while(!swap.isClaimable() && !swap.isFinished()) {
            //Wait till swap becomes claimable by waiting for the bitcoin L1 transaction to confirm
            try {
                await swap.waitForBitcoinTransaction((txId, confirmations, targetConfirmations, txEtaMs) => {
                    console.log(`Bitcoin transaction ${txId} (${confirmations}/${targetConfirmations} confirmations) ETA: ${txEtaMs/1000}s`);
                });
            } catch (e) {
                console.error("Error waiting for bitcoin transaction, retrying in 10 seconds...", e);
                await new Promise(resolve => setTimeout(resolve, 10*1000));
            }
        }
        //By now the bitcoin transaction is either confirmed and the swap became claimable, or the whole swap is finished

        //Check if it finished
        if(swap.isFinished()) return swap.isSuccessful();

        //Check if the swap is claimable, if so, wait for automatic settlement, if that fails, fall-back to manual settlement
        if(swap.isClaimable()) {
            try {
                automaticSettlementSuccess = await swap.waitTillClaimedOrFronted(60);
            } catch (e) {
                console.error("Failed to wait for automatic settlement, settling manually now... ", e);
                automaticSettlementSuccess = false;
            }
        } else {
            return false;
        }
    }

    //In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
    if(!automaticSettlementSuccess) {
        console.log("Swap not automatically settled by watchtowers, claiming manually!");
        await swap.claim(evmWallet);
    }
    console.log("Swap successfully executed!");
}

main();
