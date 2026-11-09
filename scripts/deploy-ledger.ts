/**
 * MintGuard — deploy the on-chain reputation ledger to NEAR testnet.
 *
 *   npx tsx scripts/deploy-ledger.ts
 *
 * Deploys contracts/reputation-ledger/target/wasm32-unknown-unknown/release/
 * mintguard_reputation_ledger.wasm to the agent's own testnet account
 * (mintguard.testnet), then calls `new` to initialise state, then verifies
 * with view calls (`verdict_count` == 0, `get_verdict` == null).
 *
 * Testnet-only. Keys come from .env.local via src/signing/mpc.ts
 * (getNearCredentials) — never printed. Aborts if the account balance is
 * below 3 NEAR (the ~219 KB wasm costs ~2.2 NEAR of storage).
 *
 * Safe to re-run: a second deploy replaces the code (state is preserved
 * only if the schema is unchanged — for a fresh ledger, redeploy + `new`
 * is idempotent as long as no verdicts exist yet).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { actionCreators } from "@near-js/transactions";
import { createNearAccount, getNearCredentials } from "../src/signing/mpc.js";
import {
  LEDGER_CALL_GAS,
  LEDGER_CONTRACT_ID,
  LEDGER_EXPLORER,
  accountBalanceNear,
  getVerdictOnChain,
  txHashOf,
  verdictCountOnChain,
} from "../src/reputation/onchain-ledger.js";

const WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "contracts",
  "reputation-ledger",
  "target",
  "wasm32-unknown-unknown",
  "release",
  "mintguard_reputation_ledger.wasm",
);

async function main(): Promise<void> {
  const { accountId, privateKey } = getNearCredentials();
  if (accountId !== LEDGER_CONTRACT_ID) {
    throw new Error(
      `NEAR_ACCOUNT_ID is ${accountId}, expected ${LEDGER_CONTRACT_ID} — the ledger deploys to the agent account.`,
    );
  }
  const code = new Uint8Array(readFileSync(WASM_PATH));
  console.log(`Contract account : ${LEDGER_CONTRACT_ID}`);
  console.log(`WASM             : ${WASM_PATH}`);
  console.log(`WASM size        : ${code.length} bytes`);

  const balance = await accountBalanceNear(accountId);
  console.log(`Account balance  : ${balance} NEAR`);
  if (balance < 3) {
    throw new Error(
      `Balance ${balance} NEAR < 3 NEAR minimum — top up ${accountId} from the testnet faucet first.`,
    );
  }

  const account = createNearAccount(accountId, privateKey, "testnet");

  console.log("Deploying contract code...");
  const deploy = await account.signAndSendTransaction({
    receiverId: accountId,
    actions: [actionCreators.deployContract(code)],
  });
  const deployHash = txHashOf(deploy);
  console.log(`Deploy tx        : ${deployHash}`);
  console.log(`Explorer         : ${LEDGER_EXPLORER}/txns/${deployHash}`);

  console.log("Initialising state (new)...");
  const init = await account.signAndSendTransaction({
    receiverId: accountId,
    actions: [actionCreators.functionCall("new", {}, LEDGER_CALL_GAS, 0n)],
  });
  const initHash = txHashOf(init);
  console.log(`Init tx          : ${initHash}`);
  console.log(`Explorer         : ${LEDGER_EXPLORER}/txns/${initHash}`);

  // Verify: empty ledger.
  const count = await verdictCountOnChain();
  console.log(`verdict_count    : ${count} (expected 0)`);
  if (count !== 0) throw new Error(`Ledger not empty after init: count=${count}`);
  const gloop = await getVerdictOnChain("0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE");
  console.log(`get_verdict(GLOOP): ${JSON.stringify(gloop)} (expected null)`);
  if (gloop !== null) throw new Error("Ledger not empty after init: GLOOP already has a verdict");

  console.log(`LEDGER LIVE: ${LEDGER_CONTRACT_ID} — ${LEDGER_EXPLORER}/accounts/${LEDGER_CONTRACT_ID}`);
}

main().catch((err) => {
  console.error(`GAGAL: ${err?.message ?? err}`);
  process.exit(1);
});
