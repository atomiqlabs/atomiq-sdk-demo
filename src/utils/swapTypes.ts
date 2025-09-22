import {swapper, Tokens} from "../setup";
import {SwapType} from "@atomiqlabs/sdk";


async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up), does does the initial
    // handshake to LPs to get supported token pairs
    await swapper.init();

    //Get swap type by tokens being swapped (should also be type-infered), we can also see the swap features of the respective swap types
    const swapTypeBtcToSol = swapper.getSwapType(Tokens.BITCOIN.BTC, Tokens.SOLANA.SOL);
    console.log("Swap type for BTC -> SOL: "+SwapType[swapTypeBtcToSol], swapper.SwapTypeInfo[swapTypeBtcToSol]);
    const swapTypeBtcToStrk = swapper.getSwapType(Tokens.BITCOIN.BTC, Tokens.STARKNET.STRK);
    console.log("Swap type for BTC -> STRK: "+SwapType[swapTypeBtcToStrk], swapper.SwapTypeInfo[swapTypeBtcToStrk]);
    const swapTypeBtcLnToSol = swapper.getSwapType(Tokens.BITCOIN.BTCLN, Tokens.SOLANA.SOL);
    console.log("Swap type for BTCLN -> SOL: "+SwapType[swapTypeBtcLnToSol], swapper.SwapTypeInfo[swapTypeBtcLnToSol]);
    const swapTypeBtcLnToStrk = swapper.getSwapType(Tokens.BITCOIN.BTCLN, Tokens.STARKNET.STRK);
    console.log("Swap type for BTCLN -> STRK: "+SwapType[swapTypeBtcLnToStrk], swapper.SwapTypeInfo[swapTypeBtcLnToStrk]);
    const swapTypeSolToBtc = swapper.getSwapType(Tokens.SOLANA.SOL, Tokens.BITCOIN.BTC);
    console.log("Swap type for SOL -> BTC: "+SwapType[swapTypeSolToBtc], swapper.SwapTypeInfo[swapTypeSolToBtc]);
    const swapTypeStrkToBtcLn = swapper.getSwapType(Tokens.STARKNET.STRK, Tokens.BITCOIN.BTCLN);
    console.log("Swap type for STRK -> BTCLN: "+SwapType[swapTypeStrkToBtcLn], swapper.SwapTypeInfo[swapTypeStrkToBtcLn]);

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
