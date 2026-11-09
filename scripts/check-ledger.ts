import {
  accountBalanceNear,
  listVerdictsOnChain,
  verdictCountOnChain,
} from "../src/reputation/onchain-ledger.ts";

const c = await verdictCountOnChain();
const l = await listVerdictsOnChain();
const b = await accountBalanceNear("mintguard.testnet");
console.log("count:", c);
console.log(JSON.stringify(l, null, 2));
console.log("balance now:", b, "NEAR");
