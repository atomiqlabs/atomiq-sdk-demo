import {
    AbstractSigner,
    BitcoinNetwork,
    FeeType,
    FromBTCLNSwapState, FromBTCSwapState, IBitcoinWallet, isLNURLPay, isLNURLWithdraw, LNURLPay, LNURLWithdraw,
    SCToken, SingleAddressBitcoinWallet, SpvFromBTCSwapState,
    SwapperFactory,
    ToBTCSwapState
} from "@atomiqlabs/sdk";
import {
    RpcProviderWithRetries,
    StarknetInitializer,
    StarknetInitializerType,
    StarknetKeypairWallet, StarknetSigner
} from "@atomiqlabs/chain-starknet";
import {SolanaInitializer, SolanaInitializerType, SolanaKeypairWallet, SolanaSigner} from "@atomiqlabs/chain-solana";
import {Connection, Keypair} from "@solana/web3.js";
import {SqliteStorageManager, SqliteUnifiedStorage} from "@atomiqlabs/storage-sqlite";
import * as fs from "fs";

//Create swapper factory, you can initialize it also with just a single chain (no need to always use both Solana & Starknet)
const Factory = new SwapperFactory<[StarknetInitializerType, SolanaInitializerType]>([StarknetInitializer, SolanaInitializer]);
const Tokens = Factory.Tokens;

//Initialize RPC connections for Solana & Starknet
const solanaRpc = new Connection("https://api.devnet.solana.com", "confirmed");
const starknetRpc = new RpcProviderWithRetries({nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7"});

//Create swapper instance
const swapper = Factory.newSwapper({
    chains: {
        SOLANA: {
            rpcUrl: solanaRpc
        },
        STARKNET: {
            rpcUrl: starknetRpc
        }
    },
    bitcoinNetwork: BitcoinNetwork.TESTNET,

    //By default the SDK uses browser storage, so we need to explicitly specify the sqlite storage for NodeJS, these lines are not required in browser environment
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

//Create random signers or load them from files if already generated
const solanaKey = fs.existsSync("solana.key") ? fs.readFileSync("solana.key") : Keypair.generate().secretKey;
const solanaSigner = new SolanaSigner(new SolanaKeypairWallet(Keypair.fromSecretKey(solanaKey)), Keypair.fromSecretKey(solanaKey));
fs.writeFileSync("solana.key", solanaKey);
console.log("Solana wallet address (transfer SOL here for TX fees): "+solanaSigner.getAddress());

const starknetKey = fs.existsSync("starknet.key") ? fs.readFileSync("starknet.key").toString() : StarknetKeypairWallet.generateRandomPrivateKey();
const starknetSigner = new StarknetSigner(new StarknetKeypairWallet(starknetRpc, starknetKey));
fs.writeFileSync("starknet.key", starknetKey);
console.log("Starknet wallet address (transfer STRK here for TX fees): "+starknetSigner.getAddress());

const bitcoinKey = fs.existsSync("bitcoin.key") ? fs.readFileSync("bitcoin.key").toString() : SingleAddressBitcoinWallet.generateRandomPrivateKey();
const bitcoinSigner = new SingleAddressBitcoinWallet(swapper.bitcoinRpc, swapper.bitcoinNetwork, bitcoinKey);
fs.writeFileSync("bitcoin.key", bitcoinKey);
console.log("Bitcoin wallet address (transfer BTC here for TX fees): "+bitcoinSigner.getReceiveAddress());

//Prints out parsed address details, throws when address is malformatted
async function parseAddress(address: string) {
    const res = await swapper.Utils.parseAddress(address);
    switch(res.type) {
        case "BITCOIN":
            //Bitcoin on-chain L1 address or BIP-21 URI scheme with amount
            console.log("Bitcoin on-chain address");
            if(res.amount!=null) console.log("   - amount: "+res.amount);
            break;
        case "LIGHTNING":
            //Lightning network invoice with pre-set amount
            console.log("Lightning invoice");
            console.log("   - amount: "+res.amount);
            break;
        case "LNURL":
            //LNURL payment or withdrawal link
            if(isLNURLWithdraw(res.lnurl)) {
                //LNURL-withdraw allowing withdrawals over the lightning network
                console.log("LNURL-withdraw");
                if(res.min!=null) console.log("   - withdrawable min: "+res.min);
                if(res.max!=null) console.log("   - withdrawable max: "+res.max)
                if(res.amount!=null) console.log("   - withdrawable exact: "+res.amount);
            }
            if(isLNURLPay(res.lnurl)) {
                //LNURL-pay allowing repeated payments over the lightning network
                console.log("LNURL-pay");
                if(res.min!=null) console.log("   - payable min: "+res.min);
                if(res.max!=null) console.log("   - payable max: "+res.max);
                if(res.amount!=null) console.log("   - payable exact: "+res.amount);
                console.log("   - icon data: "+res.lnurl.icon);
                console.log("   - short description: "+res.lnurl.shortDescription);
                console.log("   - long description: "+res.lnurl.longDescription);
                console.log("   - max comment length: "+res.lnurl.commentMaxLength);
            }
            break;
        default:
            //Addresses for smart chains
            console.log(res.type+" address");
            break;
    }
}

//Swap from smart chain assets (Solana, Starknet, etc.) to bitcoin lightning network L2 via BOLT11 invoice, the amount needs to be set by the recipient in the BOLT11 invoice!
async function swapToBTCLN(signer: AbstractSigner, srcToken: SCToken<any>, lightningInvoice: string) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(srcToken, Tokens.BITCOIN.BTCLN);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Available after swap rejected due to too high/low amounts
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Immediately available

    //Create swap quote
    const swap = await swapper.swap(
        srcToken, //From specified source token
        Tokens.BITCOIN.BTCLN, //Swap to BTC-LN
        undefined, //Amount is specified in the lightning network invoice!
        false, //Make sure we use exactIn=false for swaps to BTC-LN, if you want to use exactIn=true and set an amount, use LNURL-pay!
        signer.getAddress(), //Source address and smart chain signer
        lightningInvoice //Destination of the swap
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
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Is paying to non-custodial wallet: "+swap.isPayingToNonCustodialWallet()); //Whether the payment is likely being made to non-custodial lightning network wallet, it is important for the destination wallet to be online!
    console.log("   Is likely to fail: "+swap.willLikelyFail()); //Whether the lightning network payment is likely to fail (probing on the lightning network failed, but route exists)

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", ToBTCSwapState[swap.getState()]);
    });

    //Initiate the swap on the smart-chain side
    await swap.commit(signer);

    //You can also initiate the swap by sending the transactions manually and then calling swap.waitTillCommited()
    //Example for Solana
    // const txns = await swap.txsCommit();
    // txns.forEach(val => val.tx.sign(...val.signers));
    // const signedTransactions = await solanaSigner.wallet.signAllTransactions(txns.map(val => val.tx));
    // for(let tx of signedTransactions) {
    //     const res = await solanaRpc.sendRawTransaction(tx.serialize());
    //     await solanaRpc.confirmTransaction(res);
    // }
    // await swap.waitTillCommited();

    //Example for Starknet
    // const txns = await swap.txsCommit();
    // for(let tx of txns) {
    //     if(tx.type==="INVOKE") await starknetSigner.account.execute(tx.tx, tx.details);
    //     if(tx.type==="DEPLOY_ACCOUNT") await starknetSigner.account.deployAccount(tx.tx, tx.details);
    // }
    // await swap.waitTillCommited();

    //Wait for the swap to execute (lightning network payout)
    const success = await swap.waitForPayment();
    if(!success) {
        //Swap failed, we can refund now
        console.log("Swap failed, refunding back to ourselves!");
        await swap.refund(signer);
        console.log("Swap failed and refunded!");
        return;
    }

    //Swap was successful, we can retrieve lightning network payment proof (hash pre-image)
    console.log("Successfully swapped to LN, payment proof: "+swap.getSecret());
}

//Swap from smart chain assets (Solana, Starknet, etc.) to bitcoin lightning network L2 via LNURL-pay, allowing variable amount and re-usable payment address
async function swapToBTCLNViaLNURL(signer: AbstractSigner, srcToken: SCToken<any>, lnurlPay: string | LNURLPay) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(srcToken, Tokens.BITCOIN.BTCLN);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Available after swap rejected due to too high/low amounts
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Immediately available

    //Create swap quote
    const swap = await swapper.swap(
        srcToken, //From specified source token
        Tokens.BITCOIN.BTCLN, //Swap to BTC-LN
        1000n, //Now we can specify an amount for a lightning network payment!
        false, //We can also use exactIn=true here and set an amount in input token
        signer.getAddress(), //Source address and smart chain signer
        lnurlPay, //Destination of the swap
        // {
        //     comment: "Hello world" //For LNURL-pay we can also pass a comment to the recipient
        // }
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
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Is paying to non-custodial wallet: "+swap.isPayingToNonCustodialWallet()); //Whether the payment is likely being made to non-custodial lightning network wallet, it is important for the destination wallet to be online!
    console.log("   Is likely to fail: "+swap.willLikelyFail()); //Whether the lightning network payment is likely to fail (probing on the lightning network failed, but route exists)

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", ToBTCSwapState[swap.getState()]);
    });

    //Initiate the swap on the smart-chain side
    await swap.commit(signer);

    //Wait for the swap to execute (lightning network payout)
    const success = await swap.waitForPayment();
    if(!success) {
        //Swap failed, we can refund now
        console.log("Swap failed, refunding back to ourselves!");
        await swap.refund(signer);
        console.log("Swap failed and refunded!");
        return;
    }

    //LNURL-pay also supports a success action, when the user successfully executes a payment, the following can be shown to the user
    const successAction = swap.getSuccessAction();
    if(successAction!=null) {
        console.log("Success action:");
        console.log("   - description: "+successAction.description);
        console.log("   - text: "+successAction.text);
        console.log("   - url: "+successAction.url);
    }

    //Swap was successful, we can retrieve lightning network payment proof (hash pre-image)
    console.log("Successfully swapped to LN, payment proof: "+swap.getSecret());
}

//Swap from bitcoin lightning network L2 to smart chain assets (Solana, Starknet, etc.), requires manual outside payment of the displayed lightning network invoice
async function swapFromBTCLN(signer: AbstractSigner, dstToken: SCToken<any>) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTCLN, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
        dstToken, //Into specified destination token
        1000n, //1000 sats (0.00001 BTC)
        true, //Whether we define an input or output amount
        undefined, //Source address for the swap, not used for swaps from BTC-LN
        signer.getAddress() //Destination address
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
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Refundable deposit: "+swap.getSecurityDeposit()); //Refundable deposit on the destination chain, this will be taken when user commits and refunded when user claims
    console.log("   Address: "+swap.getAddress()); //Address/lightning network invoice to pay
    console.log("   Hyperlink: "+swap.getHyperlink()); //Hyperlink representation of the address/lightning network invoice

    console.log("Waiting for the manual payment of the lightning network invoice (pay it from your lightning network wallet)...");

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCLNSwapState[swap.getState()]);
    });

    //Start listening to incoming lightning network payment
    const success = await swap.waitForPayment();
    if(!success) {
        console.log("Lightning network payment not received in time and quote expired!");
        return;
    }

    console.log("Lightning payment received, claiming now!");
    try {
        if(swap.canCommitAndClaimInOneShot()) {
            //Some chains (e.g. Solana) support signing multiple transactions in one flow
            await swap.commitAndClaim(signer);
        } else {
            //Other chains (e.g. Starknet) don't support signing multiple transaction in one flow, therefore you need to sign one-by-one
            await swap.commit(signer);
            await swap.claim(signer);
        }
        console.log("Successfully claimed!");
    } catch (e) {
        console.error("Error claiming LN payment: ", e);
    }
}

//Swap from bitcoin lightning network L2 to smart chain assets (Solana, Starknet, etc.) using LNURL-withdraw withdrawal link
async function swapFromBTCLNViaLNURL(signer: AbstractSigner, dstToken: SCToken<any>, lnurlWithdraw: string | LNURLWithdraw) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTCLN, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
        dstToken, //Into specified destination token
        1000n, //1000 sats (0.00001 BTC)
        true, //Whether we define an input or output amount
        lnurlWithdraw, //Source LNURL for the swap
        signer.getAddress() //Destination address
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
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Refundable deposit: "+swap.getSecurityDeposit()); //Refundable deposit on the destination chain, this will be taken when user commits and refunded when user claims

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCLNSwapState[swap.getState()]);
    });

    //Request the lightning network payout from the LNURL-withdraw service and wait for the payment to be received
    const success = await swap.waitForPayment();
    if(!success) {
        console.log("Lightning network payment not received in time and quote expired!");
        return;
    }

    console.log("Lightning payment received, claiming now!");
    try {
        if(swap.canCommitAndClaimInOneShot()) {
            //Some chains (e.g. Solana) support signing multiple transactions in one flow
            await swap.commitAndClaim(signer);
        } else {
            //Other chains (e.g. Starknet) don't support signing multiple transaction in one flow, therefore you need to sign one-by-one
            await swap.commit(signer);
            await swap.claim(signer);
        }
        console.log("Successfully claimed!");
    } catch (e) {
        console.error("Error claiming LN payment: ", e);
    }
}

//Swap of smart chain tokens (Starknet, Solana, etc.) to Bitcoin L1 native BTC
async function swapToBTC(signer: AbstractSigner, srcToken: SCToken<any>, address: string) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(srcToken, Tokens.BITCOIN.BTC);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Available after swap rejected due to too high/low amounts
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Immediately available

    //Create swap quote
    const swap = await swapper.swap(
        srcToken, //From specified source token
        Tokens.BITCOIN.BTC, //Swap to BTC
        10000n, //Amount of the BTC to send (10000 sats = 0.0001 BTC)
        false, //We want to specify amount in output token (BTC)
        signer.getAddress(), //Source address and smart chain signer
        address, //Destination of the swap
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
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Bitcoin transaction fee rate: "+swap.getBitcoinFeeRate()+" sats/vB"); //

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", ToBTCSwapState[swap.getState()]);
    });

    //Initiate the swap on the smart-chain side
    await swap.commit(signer);

    //Wait for the swap to execute
    const success = await swap.waitForPayment();
    if(!success) {
        //Swap failed, we can refund now
        console.log("Swap failed, refunding back to ourselves!");
        await swap.refund(signer);
        console.log("Swap failed and refunded!");
        return;
    }

    //Swap was successful, we can retrieve the bitcoin transaction ID of the swap payout
    console.log("Successfully swapped to BTC L1, bitcoin txId: "+swap.getOutputTxId());
}

//Swap of on-chain BTC -> Solana assets (uses old swap protocol)
async function swapFromBTCSolana(btcWallet: IBitcoinWallet, dstToken: SCToken<"SOLANA">, signer: SolanaSigner) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTC, //Swap from BTC
        dstToken, //Into specified destination token
        2000n, //1000 sats (0.00001 BTC)
        true, //Whether we define an input or output amount
        undefined, //Source address for the swap, not used for swaps from BTC
        signer.getAddress() //Destination address
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
    console.log("   Quote expiry: "+swap.getQuoteExpiry()+" (in "+(swap.getQuoteExpiry()-Date.now())/1000+" seconds)"); //Quote expiration
    console.log("   Bitcoin swap address expiry: "+swap.getTimeoutTime()+" (in "+(swap.getTimeoutTime()-Date.now())/1000+" seconds)"); //Expiration of the opened up bitcoin swap address, no funds should be sent after this time!
    console.log("   Price:"); //Pricing information
    console.log("       - swap: "+swap.getPriceInfo().swapPrice); //Price of the current swap (excluding fees)
    console.log("       - market: "+swap.getPriceInfo().marketPrice); //Current market price
    console.log("       - difference: "+swap.getPriceInfo().difference); //Difference between the swap price & current market price
    console.log("   Refundable deposit: "+swap.getSecurityDeposit()); //Refundable deposit on the destination chain, this will be taken when user creates the swap and refunded when user finishes it
    console.log("   Watchtower fee: "+swap.getClaimerBounty()); //Fee pre-funded on the destination chain, this will be used as a fee for watchtower to automatically claim the swap on the destination on behalf of the user

    //Add a listener for swap state changes (optional)
    swap.events.on("swapState", (swap) => {
        console.log("Swap state changed: ", FromBTCSwapState[swap.getState()]);
    });

    //Initiate the swap on the destination chain (Solana) by opening up the bitcoin swap address
    console.log("Opening swap address...");
    await swap.commit(signer);
    console.log("Swap address opened!");

    //Send the bitcoin transaction after swap address is opened
    console.log("Sending bitcoin transaction...");
    const bitcoinTxId = await swap.sendBitcoinTransaction(btcWallet);
    console.log("Bitcoin transaction sent: "+bitcoinTxId);

    //Or obtain the funded PSBT (input already added) - ready for signing
    // const {psbt, signInputs} = await swap.getFundedPsbt({address: "", publicKey: ""});
    // for(let signIdx of signInputs) {
    //     psbt.signIdx(..., signIdx); //Or pass it to external signer
    // }
    // const bitcoinTxId = await swap.submitPsbt(psbt);

    //Wait for the bitcoin on-chain transaction to confirm
    await swap.waitForBitcoinTransaction(
        undefined, 5,
        (txId, confirmations, targetConfirmations, txEtaMs) => {
            if(txId==null) return;
            console.log("Swap transaction "+txId+" ("+confirmations+"/"+targetConfirmations+") ETA: "+(txEtaMs/1000)+"s");
        }
    );

    console.log("Bitcoin transaction "+bitcoinTxId+" confirmed! Waiting for automatic claim by the watchtowers...");
    try {
        await swap.waitTillClaimed(AbortSignal.timeout(30*1000));
        console.log("Successfully claimed by the watchtower!");
    } catch (e) {
        console.log("Swap not claimed by watchtowers, claiming manually!");
        await swap.claim(signer);
        console.log("Successfully claimed!");
    }
}

//Swap of on-chain BTC -> Starknet assets (uses new swap protocol)
async function swapFromBTCStarknet(btcWallet: IBitcoinWallet, dstToken: SCToken<"STARKNET">, signer: StarknetSigner) {
    //We can retrieve swap limits before we execute the swap,
    // NOTE that only swap limits denominated in BTC are immediately available
    const swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, dstToken);
    console.log("Swap limits, input min: "+swapLimits.input.min+" input max: "+swapLimits.input.max); //Immediately available
    console.log("Swap limits, output min: "+swapLimits.output.min+" output max: "+swapLimits.output.max); //Available after swap rejected due to too high/low amounts

    //Create swap quote
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTC, //Swap from BTC
        dstToken, //Into specified destination token
        3000n, //3000 sats (0.00003 BTC)
        true, //Whether we define an input or output amount
        undefined, //Source address for the swap, not used for swaps from BTC
        signer.getAddress(), //Destination address
        // {
        //     gasAmount: 1_000_000_000_000_000_000n //We can also request a gas drop on the destination chain (here requesting 1 STRK)
        // }
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

    //Send the bitcoin transaction
    console.log("Sending bitcoin transaction...");
    const bitcoinTxId = await swap.sendBitcoinTransaction(btcWallet);
    console.log("Bitcoin transaction sent: "+bitcoinTxId);

    //Or obtain the funded PSBT (input already added) - ready for signing
    // const {psbt, signInputs} = await swap.getFundedPsbt({address: "", publicKey: ""});
    // for(let signIdx of signInputs) psbt.signIdx(..., signIdx); //Or pass it to external signer
    // const bitcoinTxId = await swap.submitPsbt(psbt);

    //Or obtain raw PSBT to which inputs still need to be added
    const {psbt, in1sequence} = await swap.getPsbt();
    // psbt.addInput(...);
    // //Make sure the second input's sequence (index 1) is as specified in the in1sequence variable
    // psbt.updateInput(1, {sequence: in1sequence});
    // //Sign the PSBT, sign every input except the first one
    // for(let i=1;i<psbt.inputsLength; i++) psbt.signIdx(..., i); //Or pass it to external signer
    // //Submit the signed PSBT
    // const bitcoinTxId = await swap.submitPsbt(psbt);

    //Wait for the bitcoin on-chain transaction to confirm
    await swap.waitForBitcoinTransaction(
        undefined, 5,
        (txId, confirmations, targetConfirmations, txEtaMs) => {
            if(txId==null) return;
            console.log("Swap transaction "+txId+" ("+confirmations+"/"+targetConfirmations+") ETA: "+(txEtaMs/1000)+"s");
        }
    );

    console.log("Bitcoin transaction "+bitcoinTxId+" confirmed! Waiting for automatic claim by the watchtowers...");
    try {
        await swap.waitTillClaimedOrFronted(AbortSignal.timeout(30*1000));
        console.log("Successfully claimed by the watchtower!");
    } catch (e) {
        console.log("Swap not claimed by watchtowers, claiming manually!");
        await swap.claim(signer);
        console.log("Successfully claimed!");
    }
}

async function main() {
    //Address parsing
    // //LNURL-pay static internet identifier
    // await parseAddress("chicdeal13@walletofsatoshi.com");
    // //Bitcoin on-chain address
    // await parseAddress("tb1ql8d7vqr9mmuqwwrruz45zwxxa5apmmlra04s4f");
    // //Bitcoin BIP-21 payment URI
    // await parseAddress("bitcoin:tb1ql8d7vqr9mmuqwwrruz45zwxxa5apmmlra04s4f?amount=0.0001");
    // //BOLT11 lightning network invoice
    // await parseAddress("lntb10u1p5zwshxpp5jscdeenmxu66ntydmzhhmnwhw36md9swldy8g25875q42rld5z0sdrc2d2yz5jtfez4gtfs0qcrvefnx9jryvfcv93kvc34vyengvekxsenqdny8q6xxd34xqurgerp893njcnpv5crjefjvg6nse3exenxvdnxxycnzvecvcurxephcqpexqzz6sp58pcdqc5ztrr8ech3gzgrw9rxp50edwft9uqnnch9706nsqchv9ss9qxpqysgqasmulwmczrjhwg4vp9tqlat7lns8u80wvrcsreug8fpvna6p3arslsukkh5n83rqu6auvcrl7h6vczwaq58nu9mz60t03xtvrwz6vmsq6pv7zx");
    // //LNURL-pay link
    // await parseAddress("LNURL1DP68GURN8GHJ7MRWVF5HGUEWVDAZ7MRWW4EXCUP0FP692S6TDVYS94YU");
    // //LNURL-withdraw link
    // await parseAddress("LNURL1DP68GURN8GHJ7MRWVF5HGUEWVDAZ7AMFW35XGUNPWUHKZURF9AMRZTMVDE6HYMP0DP65YW2Y2FF8X7NC2DHY6AZHVEJ8SS6EGEPQ55X0HQ");
    // //Starknet wallet address
    // await parseAddress("0x06e31d218acfb5a34364306d84c65084da9c9bae09e2b58f96ff6f11138f83d7");
    // //Solana wallet address
    // await parseAddress("7fZcxMrQpeeLjtLPQmWzY1pNwGtfoGjVai3SH4uPPdv3");

    // //Wallet helpers
    // //Spendable balance of the starknet wallet address (discounting transaction fees)
    // const strkBalance = await swapper.Utils.getSpendableBalance(starknetSigner, Tokens.STARKNET.STRK);
    // console.log("Starknet signer balance: "+strkBalance);
    // //Spendable balance of the solana wallet address (discounting transaction fees)
    // const solBalance = await swapper.Utils.getSpendableBalance(solanaSigner, Tokens.SOLANA.SOL);
    // console.log("Solana signer balance: "+solBalance);
    // //Spendable balance of the bitcoin wallet - here we also need to specify the destination chain (as there are different swap protocols available with different on-chain footprints)
    // const {balance: btcBalance, feeRate: btcFeeRate} = await swapper.Utils.getBitcoinSpendableBalance(bitcoinSigner, "SOLANA");
    // console.log("Bitcoin signer balance: "+btcBalance);

    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();

    // //Retrieve existing swap by it's ID, you can get the ID of the swap with swap.getId()
    // const swap = await swapper.getSwapById("9a03b4c29264c2383f6fbe94130ecec4b230880ef437b7e515f939f187ee7efb38e546f42d66c13490b84fd7ad379aad");
    // console.log(swap);

    // //Get refundable swaps and refund them
    // const refundableSolanaSwaps = await swapper.getRefundableSwaps("SOLANA", solanaSigner.getAddress());
    // for(let swap of refundableSolanaSwaps) await swap.refund(solanaSigner);
    // const refundableStarknetSwaps = await swapper.getRefundableSwaps("STARKNET", starknetSigner.getAddress());
    // for(let swap of refundableStarknetSwaps) await swap.refund(starknetSigner);

    //Execute the action
    await swapFromBTCStarknet(bitcoinSigner, Tokens.STARKNET.STRK, starknetSigner);

    //Stops the swapper instance, no more swaps can happen
    await swapper.stop();
}

main();
