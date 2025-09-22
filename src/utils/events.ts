import {swapper, Tokens} from "../setup";
import {SwapAmountType} from "@atomiqlabs/sdk";
import {starknetWallet} from "../wallets";


async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up), does does the initial
    // handshake to LPs to get supported token pairs
    await swapper.init();

    //Triggers on swap state changes
    swapper.on("swapState", (swap) => {
        console.log(`Swap state changed ${swap.getId()}: ${swap.getState()}`);
    });
    //Create a swap and wait for payment, should trigger the swapState listener
    const swap = await swapper.swap(Tokens.BITCOIN.BTCLN, Tokens.STARKNET.STRK, "0.00005", SwapAmountType.EXACT_IN, undefined, starknetWallet.address);
    try {
        await swap.waitForPayment(undefined, undefined, AbortSignal.timeout(3000));
    } catch (e) {}

    //Notifications about swap limits being changed
    swapper.on("swapLimitsChanged", () => {
        console.log("Swap limits changed", swapper.getSwapBounds());
    });
    //Trigger the prior listener by swapping too little (the LP responds with new minimum/maximum amounts)
    try {
        await swapper.swap(Tokens.BITCOIN.BTCLN, Tokens.STARKNET.STRK, "0", SwapAmountType.EXACT_OUT, undefined, starknetWallet.address);
    } catch (e) {
        //Will throw with Out of bounds error
        console.error(e);
    }

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
