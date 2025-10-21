import {isLNURLPay, isLNURLWithdraw} from "@atomiqlabs/sdk";
import {swapper} from "../setup";

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

async function main() {
    //Address parsing
    //LNURL-pay static internet identifier
    await parseAddress("chicdeal13@walletofsatoshi.com");
    //Bitcoin on-chain address
    await parseAddress("tb1ql8d7vqr9mmuqwwrruz45zwxxa5apmmlra04s4f");
    //Bitcoin BIP-21 payment URI
    await parseAddress("bitcoin:tb1ql8d7vqr9mmuqwwrruz45zwxxa5apmmlra04s4f?amount=0.0001");
    //BOLT11 lightning network invoice
    await parseAddress("lntb10u1p5zwshxpp5jscdeenmxu66ntydmzhhmnwhw36md9swldy8g25875q42rld5z0sdrc2d2yz5jtfez4gtfs0qcrvefnx9jryvfcv93kvc34vyengvekxsenqdny8q6xxd34xqurgerp893njcnpv5crjefjvg6nse3exenxvdnxxycnzvecvcurxephcqpexqzz6sp58pcdqc5ztrr8ech3gzgrw9rxp50edwft9uqnnch9706nsqchv9ss9qxpqysgqasmulwmczrjhwg4vp9tqlat7lns8u80wvrcsreug8fpvna6p3arslsukkh5n83rqu6auvcrl7h6vczwaq58nu9mz60t03xtvrwz6vmsq6pv7zx");
    //LNURL-pay link
    await parseAddress("LNURL1DP68GURN8GHJ7MRWVF5HGUEWVDAZ7MRWW4EXCUP0FP692S6TDVYS94YU");
    //LNURL-withdraw link
    await parseAddress("LNURL1DP68GURN8GHJ7MRWVF5HGUEWVDAZ7AMFW35XGUNPWUHKZURF9AMRZTMVDE6HYMP0DP65YW2Y2FF8X7NC2DHY6AZHVEJ8SS6EGEPQ55X0HQ");
    //Starknet wallet address
    await parseAddress("0x06e31d218acfb5a34364306d84c65084da9c9bae09e2b58f96ff6f11138f83d7");
    //Solana wallet address
    await parseAddress("7fZcxMrQpeeLjtLPQmWzY1pNwGtfoGjVai3SH4uPPdv3");
}
main();
