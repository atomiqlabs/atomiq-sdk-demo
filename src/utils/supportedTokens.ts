import {swapper, Tokens} from "../setup";
import {SwapType} from "@atomiqlabs/sdk";


async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up), does does the initial
    // handshake to LPs to get supported token pairs
    await swapper.init();

    //Get supported tokens on the input and output
    const supportedInputTokens = swapper.getSupportedTokens(true);
    console.log("Supported inputs tokens: ", supportedInputTokens.map(value => value.name+" ("+value.ticker+")").join(", "));
    const supportedOutputTokens = swapper.getSupportedTokens(false);
    console.log("Supported inputs tokens: ", supportedOutputTokens.map(value => value.name+" ("+value.ticker+")").join(", "));

    //Get tokens from/to which you can swap based on one side of the trade
    const tokenSwappableToBitcoin = swapper.getSwapCounterTokens(Tokens.BITCOIN.BTC, true);
    console.log("Tokens that can be swapped to BTC: ", tokenSwappableToBitcoin.map(value => value.name+" ("+value.ticker+")").join(", "));
    const tokensSwappableFromSTRK = swapper.getSwapCounterTokens(Tokens.STARKNET.STRK, false);
    console.log("Tokens that STRK can be swapped to: ", tokensSwappableFromSTRK.map(value => value.name+" ("+value.ticker+")").join(", "));

    //Get token by its ticker or address
    //We can use a simple upper case ticker (throws if the same asset is on multiple chains)
    const strkToken = swapper.getToken("STRK");
    console.log("STRK token: ", strkToken);
    //We can specify the chain on which the asset is issued
    const solToken = swapper.getToken("SOLANA-SOL");
    console.log("SOL token: ", solToken);
    //We can use the token contract address
    const ethToken = swapper.getToken("0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7");
    console.log("ETH token: ", ethToken);

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}
main();
