import * as express from "express";
import * as cors from "cors";
import {swapper, Tokens} from "../setup";
import {SCToken, SwapAmountType, ToBTCLNSwap} from "@atomiqlabs/sdk";

//This example uses Solana Pay flow to create a Solana wallet scannable deeplink, that will be used to pay the
// Lightning network invoice.
//Uses express.js to run the HTTP server
//To use this simply pass a lightning network invoice to be paid and source token ticker (on Solana) to pay it with
//Endpoints:
// - swapToBtcLn - creates the swap, expect `destination` & `srcToken` param
// - refundToBtcLn - attempts to refund a failed swap, expects `destination` as a param
//NOTE: To use this with existing Solana wallets you need to use HTTPS, you can use tools like ngrok for
// local testing (this will create a tunnel allowing the outside world to access your local instance)
//You can also let the script here generate the correct deeplink by passing <domain>, <srcToken> and <destination> as command
// line arguments:
if(process.argv.length>4) {
    //Generate the deeplink here
    const domain = process.argv[2];
    const srcToken = process.argv[3];
    const destination = process.argv[4];

    //We can also smartly check the token here
    if(Tokens.SOLANA[srcToken]==null) throw new Error(`Token ${srcToken} not found in available Solana tokens`);

    //Generate the deeplinks
    const swapUrl = `https://${domain}/swapToBtcLn?srcToken=${srcToken}&destination=${destination}`;
    const refundUrl = `https://${domain}/refundToBtcLn?srcToken=${srcToken}&destination=${destination}`;

    const swapDeeplink = `solana:${encodeURIComponent(swapUrl)}`;
    const refundDeeplink = `solana:${encodeURIComponent(refundUrl)}`;

    console.log(`Swap initiate solana deeplink: ${swapDeeplink}`);
    console.log(`Swap refund solana deeplink: ${refundDeeplink}`);
}

//Common function for parsing an verifying the request
function parseRequest(req: express.Request, res: express.Response): {
    token: SCToken<"SOLANA">,
    destination: string
} | null {
    //Parse params
    const {
        srcToken,
        destination
    } = req.query;

    //Verify correct source token
    if(typeof(srcToken)!=="string" || !Tokens.SOLANA[srcToken]) {
        res.status(400).json({message: "Invalid srcToken - not found"});
        return null;
    }
    const token = Tokens.SOLANA[srcToken];

    //Verify destination
    if(typeof(destination)!=="string" || !swapper.Utils.isValidLightningInvoice(destination)) {
        res.status(400).json({message: "Invalid destination - only BOLT11 lightning network invoices are allowed"});
        return null;
    }

    return {token, destination};
}

async function main() {
    const app = express();
    //IMPORTANT: We need to setup CORS
    app.use(cors());
    //Also don't forget to setup a JSON body parser
    app.use(express.json());

    //Initialize the swapper instance (you should do this just once when your app starts up)
    await swapper.init();


    ///////
    //Handlers for creating the swaps

    //Setup handler for GET requests
    //This is called first when the wallet wants to know what message should be displayed to the user
    app.get("/swapToBtcLn", (req, res) => {
        const params = parseRequest(req, res);
        if(!params) return;

        //Extract amount in sats from the lightning invoice
        const amountSats = swapper.Utils.getLightningInvoiceValue(params.destination);

        res.status(200).json({
            //You can use your own customization, like own logo and text
            icon: "https://app.atomiq.exchange/icons/atomiq-flask.png",
            label: `Swap ${params.token.ticker} to ${amountSats.toString(10)} sats`
        });
    });

    //Setup handler for POST requests on the same path as the GET request
    //This is called after, when the user approves the action in the wallet
    app.post("/swapToBtcLn", async (req, res) => {
        const params = parseRequest(req, res);
        if(!params) return;

        //Now the user's account is passed in the JSON request body
        const {account} = req.body;
        if(!account) {
            res.status(400).json({message: "Invalid account specified!"});
            return;
        }

        try {
            //Create the Solana -> BTC-LN swap
            const swap = await swapper.swap(
                params.token, //Swap from specified token
                Tokens.BITCOIN.BTCLN, //To BTC-LN
                undefined, //Amount is specified in the fixed amount lightning invoice
                SwapAmountType.EXACT_OUT, //Only EXACT_OUT swaps are possible with regular LN invoices
                account, //Source account is the Solana account of the user
                params.destination //Lightning invoice passed in the query params
            );

            //Export Solana transaction required to initiate the swap (we can use skipChecks=true, when calling it right
            // after getting the quote)
            const txs = await swap.txsCommit(true);

            //Check that just a single transaction is returned (should always be the case anyway!)
            if(txs.length>1) {
                res.status(500).json({message: "Unsupported Solana txns returned!"});
                return;
            }

            res.status(200).json({
                //Send back the encoded Solana transaction
                transaction: txs[0].tx.serialize({requireAllSignatures: false}).toString("base64"),
                //You can freely customize the message
                message: `Swap ${swap.getInput().toString()} to ${swap.getOutput().toString()} initiated!`
            });
        } catch (e) {
            console.error("Error when creating swap: ", e);
            res.status(500).json({message: `Unable to create the swap: ${e.message ?? e.toString()}`});
            return;
        }
    });


    ///////
    //Handlers for refunding the swaps

    //Setup handler for GET requests
    //This is called first when the wallet wants to know what message should be displayed to the user
    app.get("/refundToBtcLn", (req, res) => {
        //The expected request param should be just `destination`
        const {destination} = req.query;
        if(typeof(destination)!=="string" || !swapper.Utils.isValidLightningInvoice(destination)) {
            res.status(400).json({message: "Invalid destination - only BOLT11 lightning network invoices are allowed"});
            return;
        }

        res.status(200).json({
            //You can use your own customization, like own logo or text
            icon: "https://app.atomiq.exchange/icons/atomiq-flask.png",
            label: `Refund prior swap to ${destination}`
        });
    });

    //Setup handler for POST requests on the same path as the GET request
    //This is called after, when the user approves the action in the wallet
    app.post("/refundToBtcLn", async (req, res) => {
        //The expected request param should be just `destination`
        const {destination} = req.query;
        if(typeof(destination)!=="string" || !swapper.Utils.isValidLightningInvoice(destination)) {
            res.status(400).json({message: "Invalid destination - only BOLT11 lightning network invoices are allowed"});
            return;
        }

        //Now the user's account is passed in the JSON request body
        const {account} = req.body;
        if (!account) {
            res.status(400).json({message: "Invalid account specified!"});
            return;
        }

        //Fetch refundable swaps for the account
        const refundableSwaps = await swapper.getRefundableSwaps("SOLANA", account);
        //Find the swap that paid to the invoice supplied in the `destination` query param
        const swap = refundableSwaps.find(value => {
            return value instanceof ToBTCLNSwap && value.getOutputAddress()===destination;
        }) as unknown as ToBTCLNSwap;

        //Check if the swap exists
        if(swap==null) {
            res.status(400).json({message: "Prior swap not found!"});
            return;
        }

        //Check if swap is successful
        if(swap.isSuccessful()) {
            res.status(400).json({message: `Swap was successful, no refund necessary, payment preimage: ${swap.getSecret()}`});
            return;
        }

        //Check if swap quote expired
        if(swap.isQuoteExpired()) {
            res.status(400).json({message: `Swap quote has expired before init transaction was received, no swap happened!`});
            return;
        }

        //Check if swap quote already refunded
        if(swap.isFailed()) {
            res.status(400).json({message: `Swap already refunded!`});
            return;
        }

        //Check if swap quote already refunded
        if(!swap.isRefundable()) {
            res.status(400).json({message: `Swap still pending...`});
            return;
        }

        //Here we can get the refund transaction and attempt a refund
        const txs = await swap.txsRefund(account);

        //Check that just a single transaction is returned (should always be the case anyway!)
        if(txs.length>1) {
            res.status(500).json({message: "Unsupported Solana txns returned!"});
            return;
        }

        res.status(200).json({
            //Send back the encoded Solana transaction
            transaction: txs[0].tx.serialize({requireAllSignatures: false}).toString("base64"),
            //You can freely customize the message
            message: `Refunded swap to ${destination}`
        });
    });

    app.listen(3000, () => console.log("Solana Action HTTP server started!"));
}
main();
