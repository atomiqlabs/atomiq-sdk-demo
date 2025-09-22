import {BitcoinNetwork, SwapperFactory} from "@atomiqlabs/sdk";
import {StarknetInitializer, StarknetInitializerType} from "@atomiqlabs/chain-starknet";
import {SolanaInitializer, SolanaInitializerType} from "@atomiqlabs/chain-solana";
import {CitreaInitializer, CitreaInitializerType} from "@atomiqlabs/chain-evm";
import {Connection} from "@solana/web3.js";
import {JsonRpcProvider} from "ethers";
import {NostrMessenger} from "@atomiqlabs/messenger-nostr";
import {SqliteStorageManager, SqliteUnifiedStorage} from "@atomiqlabs/storage-sqlite";
import * as WebSocket from 'ws';
import {RpcProvider} from "starknet";

//You can bump up the log level with atomiqLogLevel global variable
// global.atomiqLogLevel = 3;

//Create swapper factory, you can initialize it also with just a single chain (no need to always use both Solana & Starknet)
const Factory = new SwapperFactory<[StarknetInitializerType, SolanaInitializerType, CitreaInitializerType]>([StarknetInitializer, SolanaInitializer, CitreaInitializer]);
const Tokens = Factory.Tokens;

//Initialize RPC connections for Solana & Starknet
const solanaRpc = new Connection("https://api.devnet.solana.com", "confirmed");
const starknetRpc = new RpcProvider({nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_9"});
const citreaRpc = new JsonRpcProvider("https://rpc.testnet.citrea.xyz");

//Create swapper instance
const swapper = Factory.newSwapper({
    chains: {
        SOLANA: {
            rpcUrl: solanaRpc
        },
        STARKNET: {
            rpcUrl: starknetRpc
        },
        CITREA: {
            rpcUrl: citreaRpc,
            chainType: "TESTNET4"
        }
    },
    bitcoinNetwork: BitcoinNetwork.TESTNET4,
    messenger: new NostrMessenger(BitcoinNetwork.TESTNET4, ["wss://relay.damus.io", "wss://nostr.einundzwanzig.space", "wss://nostr.mutinywallet.com"], {
        wsImplementation: WebSocket as any
    }),

    //By default the SDK uses browser storage, so we need to explicitly specify the sqlite storage for NodeJS
    // these lines are not required in browser environment!!!
    swapStorage: chainId => new SqliteUnifiedStorage("CHAIN_"+chainId+".sqlite3"),
    chainStorageCtor: name => new SqliteStorageManager("STORE_"+name+".sqlite3"),

    //Additional optional options
    // pricingFeeDifferencePPM: 20000n, //Maximum allowed pricing difference for quote (between swap & market price) in ppm (parts per million) (20000 == 2%)
    // mempoolApi: new MempoolApi("<url to custom mempool.space instance>"), //Set the SDK to use a custom mempool.space instance instead of the public one
    // getPriceFn: (tickers: string[], abortSignal?: AbortSignal) => customPricingApi.getUsdPriceForTickers(tickers) //Overrides the default pricing API engine with a custom price getter
    //
    // intermediaryUrl: "<url to custom LP node>",
    // registryUrl: "<url to custom LP node registry>",
    //
    // getRequestTimeout: 10000, //Timeout in milliseconds for GET requests
    // postRequestTimeout: 10000, //Timeout in milliseconds for POST requests
    // defaultAdditionalParameters: {lpData: "Pls give gud price"}, //Additional request data sent to LPs
    //
    // defaultTrustedIntermediaryUrl: "<url to custom LP node>", //LP node/intermediary to use for trusted gas swaps
});

//Export the swapper and the available tokens
export {
    swapper,
    Tokens,

    //We can also export the RPCs, will be useful for wallets
    solanaRpc,
    starknetRpc,
    citreaRpc
};
