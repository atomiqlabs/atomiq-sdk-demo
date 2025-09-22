import {swapper} from "../setup";
import {solanaWallet, starknetWallet} from "../wallets";

async function main() {
    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    // //Retrieve existing swap by it's ID, you can get the ID of the swap with swap.getId()
    // const swap = await swapper.getSwapById("9a03b4c29264c2383f6fbe94130ecec4b230880ef437b7e515f939f187ee7efb38e546f42d66c13490b84fd7ad379aad");
    // console.log(swap);

    //Retrieve past swaps that can be refunded by the wallet
    const refundableSolanaSwaps = await swapper.getRefundableSwaps("SOLANA", solanaWallet.publicKey.toString());
    for(let swap of refundableSolanaSwaps) await swap.refund(solanaWallet);
    const refundableStarknetSwaps = await swapper.getRefundableSwaps("STARKNET", starknetWallet.address);
    for(let swap of refundableStarknetSwaps) await swap.refund(starknetWallet);

    //Retrieve past swaps that can be claimed manually by the wallet
    const claimableSolanaSwaps = await swapper.getClaimableSwaps("SOLANA", solanaWallet.publicKey.toString());
    for(let swap of claimableSolanaSwaps) await swap.claim(solanaWallet);
    const claimableStarknetSwaps = await swapper.getClaimableSwaps("STARKNET", starknetWallet.address);
    for(let swap of claimableStarknetSwaps) await swap.claim(starknetWallet);

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}

main();
