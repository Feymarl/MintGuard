/**
 * MintGuard — vet a contract, then record the verdict on-chain.
 *
 *   npx tsx scripts/record-verdict.ts --ca 0x... [--chain bsc] [--wallet 0x...]
 *
 * This is the wiring between the vetting flow and the on-chain reputation
 * ledger: it runs the same `vetContract` the agent uses, then calls the
 * ledger contract's `record_verdict` from the agent's NEAR testnet account,
 * then reads the verdict back with a view call to prove it is on-chain.
 *
 * Testnet-only. Keys come from .env.local via src/signing/mpc.ts — never
 * printed. The verdict recorded is exactly the verdict the engine
 * returned (no manual override); `--reason` only overrides the short
 * reason string when given, otherwise the engine's top reason is used.
 */
import { createNearAccount, getNearCredentials } from "../src/signing/mpc.js";
import { vetContract } from "../src/vetting/verdict.js";
import type { VettingVerdict } from "../src/vetting/core/types.js";
import {
  LEDGER_CONTRACT_ID,
  LEDGER_EXPLORER,
  getVerdictOnChain,
  listVerdictsOnChain,
  recordVerdictOnChain,
  verdictCountOnChain,
} from "../src/reputation/onchain-ledger.js";

function parseArgs(argv: string[]): {
  ca?: string;
  chain: string;
  wallet?: string;
  reason?: string;
} {
  let ca: string | undefined;
  let chain = "bsc";
  let wallet: string | undefined;
  let reason: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ca" && argv[i + 1]) ca = argv[++i];
    else if (argv[i] === "--chain" && argv[i + 1]) chain = argv[++i];
    else if (argv[i] === "--wallet" && argv[i + 1]) wallet = argv[++i];
    else if (argv[i] === "--reason" && argv[i + 1]) reason = argv[++i];
  }
  return { ca, chain, wallet, reason };
}

/** Short on-chain reason from the engine output: the simulation revert
 *  first (the most informative single fact), else the top risk message. */
function pickReason(v: VettingVerdict): string {
  if (!v.simulationOk && v.simulationError) {
    return `sim reverted: ${v.simulationError}`;
  }
  const top =
    v.risks.find((r) => r.severity === "block") ??
    v.risks.find((r) => r.severity === "warn") ??
    v.risks[0];
  if (top) return top.message;
  return v.verdict === "SAFE" ? "all checks passed" : "vetting completed";
}

async function main(): Promise<void> {
  const { ca, chain, wallet, reason } = parseArgs(process.argv.slice(2));
  if (!ca) throw new Error("Pakai --ca <0x...>");
  console.log(`Vetting ${ca} (chain ${chain})...`);
  const verdict = await vetContract(ca, { chain, walletAddress: wallet });
  const v = verdict.verdict as string;
  const score = verdict.score as number;
  const topReason = reason ?? pickReason(verdict);
  console.log(`Engine verdict  : ${v} ${score} — ${topReason}`);
  console.log(`Ledger contract  : ${LEDGER_CONTRACT_ID}`);

  const { accountId, privateKey } = getNearCredentials();
  const account = createNearAccount(accountId, privateKey, "testnet");
  console.log(`Recording as     : ${accountId}...`);
  const { txHash } = await recordVerdictOnChain(account, {
    contract_address: ca,
    verdict: v,
    score,
    reason: topReason.slice(0, 500),
    chain,
  });
  console.log(`Record tx        : ${txHash}`);
  console.log(`Explorer         : ${LEDGER_EXPLORER}/txns/${txHash}`);

  // Read back: prove the verdict is on-chain.
  const back = await getVerdictOnChain(ca);
  console.log(`get_verdict      : ${JSON.stringify(back)}`);
  if (!back) throw new Error("get_verdict returned null after recording");
  if (back.verdict !== v || back.score !== score) {
    throw new Error(
      `Read-back mismatch: on-chain ${back.verdict} ${back.score}, engine said ${v} ${score}`,
    );
  }
  const count = await verdictCountOnChain();
  const all = await listVerdictsOnChain();
  console.log(`verdict_count    : ${count}`);
  console.log(`ON-CHAIN ✓ ${ca} → ${back.verdict} ${back.score} (agent ${back.agent}, ${all.length} entr${all.length === 1 ? "y" : "ies"} total)`);
}

main().catch((err) => {
  console.error(`GAGAL: ${err?.message ?? err}`);
  process.exit(1);
});
