import * as fs from "fs";
import {Keypair} from "@solana/web3.js";
import {SolanaKeypairWallet} from "@atomiqlabs/chain-solana";
import {StarknetKeypairWallet} from "@atomiqlabs/chain-starknet";
import {BaseWallet, SigningKey, Wallet} from "ethers";
import {SingleAddressBitcoinWallet} from "@atomiqlabs/sdk";
import {citreaRpc, starknetRpc, swapper} from "./setup";

//Create random signers or load them from files if already generated
const solanaKey = fs.existsSync("solana.key") ? fs.readFileSync("solana.key") : Keypair.generate().secretKey;
const solanaWallet = new SolanaKeypairWallet(Keypair.fromSecretKey(solanaKey));
fs.writeFileSync("solana.key", solanaKey);
console.log("Solana wallet address (transfer SOL here for TX fees): "+solanaWallet.publicKey.toString());

const starknetKey = fs.existsSync("starknet.key") ? fs.readFileSync("starknet.key").toString() : StarknetKeypairWallet.generateRandomPrivateKey();
const starknetWallet = new StarknetKeypairWallet(starknetRpc, starknetKey);
fs.writeFileSync("starknet.key", starknetKey);
console.log("Starknet wallet address (transfer STRK here for TX fees): "+starknetWallet.address);

const evmKey = fs.existsSync("evm.key") ? fs.readFileSync("evm.key").toString() : Wallet.createRandom().privateKey;
const evmWallet = new BaseWallet(new SigningKey(evmKey), citreaRpc);
fs.writeFileSync("evm.key", evmKey);
console.log("Citrea wallet address (transfer CBTC here for TX fees): "+evmWallet.address);

const bitcoinKey = fs.existsSync("bitcoin.key") ? fs.readFileSync("bitcoin.key").toString() : SingleAddressBitcoinWallet.generateRandomPrivateKey();
const bitcoinWallet = new SingleAddressBitcoinWallet(swapper.bitcoinRpc, swapper.bitcoinNetwork, bitcoinKey);
fs.writeFileSync("bitcoin.key", bitcoinKey);
console.log("Bitcoin wallet address (transfer BTC here for TX fees): "+bitcoinWallet.getReceiveAddress());

export {
    solanaWallet,
    starknetWallet,
    evmWallet,
    bitcoinWallet
}
