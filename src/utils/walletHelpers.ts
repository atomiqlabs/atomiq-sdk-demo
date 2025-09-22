import {swapper, Tokens} from "../setup";
import {bitcoinWallet, evmWallet, solanaWallet, starknetWallet} from "../wallets";


async function main() {
    //Wallet helpers
    //Spendable balance of the starknet wallet address (discounting transaction fees)
    const strkBalance = await swapper.Utils.getSpendableBalance(starknetWallet.address, Tokens.STARKNET.STRK);
    console.log("Starknet signer balance: "+strkBalance);
    //Spendable balance of the solana wallet address (discounting transaction fees)
    const solBalance = await swapper.Utils.getSpendableBalance(solanaWallet.publicKey.toString(), Tokens.SOLANA.SOL);
    console.log("Solana signer balance: "+solBalance);
    //Spendable balance of the citrea wallet address (discounting transaction fees)
    const cbtcBalance = await swapper.Utils.getSpendableBalance(evmWallet.address, Tokens.CITREA.CBTC);
    console.log("Citrea signer balance: "+cbtcBalance);
    //Spendable balance of the bitcoin wallet - here we also need to specify the destination chain (as there are different swap protocols available with different on-chain footprints)
    const {balance: btcBalance, feeRate: btcFeeRate} = await swapper.Utils.getBitcoinSpendableBalance(bitcoinWallet.address, "SOLANA");
    console.log("Bitcoin signer balance: "+btcBalance);
}
main();
