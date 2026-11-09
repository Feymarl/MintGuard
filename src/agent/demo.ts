// MintGuard — Agent demo runner (orchestration: vet -> policy -> sign -> record).
//
//   npm run demo -- --ca <0x...40> [--mode vet|sign|full] [--dry-run]
//                  [--confirm-testnet] [--account <near-account>] [--path <derive-path>]
//                  [--wallet <evm-address>] [--ledger <path>]
//
// Modes:
//   vet  (default) — vetting only. Read-only, no signing, no key needed.
//                    Safe to run against any contract.
//   sign           — vet + policy gate + derive address + sign the mint
//                    payload. No broadcast. Live mode needs a NEAR account;
//                    --dry-run uses the fake DryRunSigner instead.
//   full           — the whole flow incl. broadcast + ledger mint entry.
//                    REQUIRES --confirm-testnet (explicit intent) and is
//                    TESTNET ONLY (BSC testnet, chainId 97) — the policy
//                    gate refuses mainnet unconditionally.
//                    Live full goes through src/agent/live-full.ts:
//                    the chainsig EVM adapter prepares the tx against
//                    chain state (real nonce + gas), MPC signs it, then
//                    finalize -> broadcast -> receipt -> ownerOf. The
//                    generic sign path below is NOT used for live full:
//                    it signs a locally-built legacy tx (placeholder
//                    nonce 0, 1 gwei) whose signature can never broadcast.
//                    Live full also needs tBNB on the derived address
//                    for gas — balance 0 fails fast with faucet
//                    instructions, before any MPC sign is attempted.
//
// Signing seam: the live MPC signer (src/signing/mpc.ts) is built by a
// parallel worker. demo.ts never imports it statically — it loads it lazily
// (see loadLiveSigner) and fails with a CLEAR message if the module is not
// ready yet. --dry-run never touches it. See src/agent/types.ts for the
// SigningProvider interface the live module must satisfy.
//
// No private key / seed is ever read, printed, or written by this file.
// Live signing credentials live in .env.local (gitignored) and are consumed
// by src/signing/mpc.ts, not here.

import { ethers } from "ethers";
import { vetContract } from "../vetting/verdict.js";
import type { VettingVerdict } from "../vetting/core/types.js";
import { checkPolicy, BSC_TESTNET_CHAIN_ID, DEFAULT_MAX_GAS_WEI } from "./policy.js";
import {
  DryRunBroadcaster,
  DryRunSigner,
  type BroadcastProvider,
  type DemoMode,
  type SigningProvider,
} from "./types.js";
import { appendEntry, makeEntry, DEFAULT_LEDGER_PATH } from "../reputation/ledger.js";
import {
  buildMintCalldata,
  createLiveFullDeps,
  runLiveFullMint,
} from "./live-full.js";

// NOTE: src/signing/example-derive.ts is a CLI script, not a library — it
// runs main() on import (and would swallow process.argv). Never import it
// here; live derivation comes from the SigningProvider (loadLiveSigner).

const DERIVATION_PATH = "ethereum-1";
/** Dry-run gas estimate: 100k gas @ 1 gwei = 10^14 wei (well under ceiling). */
const DRY_RUN_GAS_WEI = 100_000n * 1_000_000_000n;

interface DemoArgs {
  ca?: string;
  mode: DemoMode;
  dryRun: boolean;
  confirmTestnet: boolean;
  account?: string;
  path: string;
  wallet?: string;
  ledgerPath: string;
  humanApprovedExact: boolean;
  /** Explicit vetting chain key (e.g. "bsc", "bsc-testnet"). When omitted,
   *  sign/full modes vet on "bsc-testnet" (the broadcast target) and vet
   *  mode vets on "bsc" (mainnet). */
  chain?: string;
  help: boolean;
}

function parseArgs(argv: string[]): DemoArgs {
  const out: DemoArgs = {
    mode: "vet",
    dryRun: false,
    confirmTestnet: false,
    path: DERIVATION_PATH,
    ledgerPath: DEFAULT_LEDGER_PATH,
    humanApprovedExact: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--ca") out.ca = next();
    else if (a === "--mode") {
      const m = next();
      if (m !== "vet" && m !== "sign" && m !== "full") {
        throw new Error(`--mode must be vet|sign|full, got "${m}"`);
      }
      out.mode = m;
    } else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--confirm-testnet") out.confirmTestnet = true;
    else if (a === "--account") out.account = next();
    else if (a === "--path") out.path = next();
    else if (a === "--wallet") out.wallet = next();
    else if (a === "--ledger") out.ledgerPath = next();
    else if (a === "--chain") out.chain = next();
    else if (a === "--human-approved-exact") out.humanApprovedExact = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage(): string {
  return [
    "Usage: npm run demo -- --ca <contract-address> [--mode vet|sign|full] [--dry-run]",
    "                       [--confirm-testnet] [--account <near-account>] [--path <derive-path>]",
    "                       [--wallet <evm-address>] [--ledger <path>] [--chain <bsc|bsc-testnet>]",
    "",
    "Modes: vet (default, read-only) | sign (vet + sign, no broadcast) | full (incl. broadcast).",
    "Mode full requires --confirm-testnet and is BSC-testnet only (chainId 97).",
    "Vetting chain: sign/full vet on bsc-testnet by default (the broadcast target);",
    "vet mode vets on bsc by default. Override with --chain <key>.",
    "Live signing needs NEAR_ACCOUNT_ID (env or --account) and the MPC signer in src/signing/mpc.ts.",
    "Live full also needs tBNB on the derived address for gas — balance 0 fails fast with faucet instructions.",
    "Use --dry-run to exercise the whole flow with a clearly-marked fake signature (no key, no tx).",
  ].join("\n");
}

interface StepLog {
  step: string;
  ms: number;
  ok: boolean;
  detail: string;
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

/**
 * Lazily load the live MPC signer built by the signing worker.
 * Expected shape (see src/agent/types.ts — SigningProvider):
 *   - a named export `createMpcSigner(accountId)` returning a SigningProvider, OR
 *   - a default-export class `MpcSigner` constructible with `new MpcSigner(accountId)`, OR
 *   - a named export `mpcSigner` already satisfying the interface.
 *
 * FALLBACK (landed 2026-11-09): src/signing/mpc.ts exports a different
 * shape — createMpcContract / deriveAddressViaMpc / signPayload /
 * getNearCredentials / createNearAccount / createSignerAccount. When the
 * seam exports above are absent, a thin adapter maps those functions onto
 * SigningProvider. No signing logic is duplicated here: every call delegates
 * to mpc.ts; this adapter only translates the call shape. If the signing
 * worker later adds `createMpcSigner`, the seam path wins automatically.
 *
 * Anything else => a clear error, never a mysterious crash.
 */
async function loadLiveSigner(accountId: string): Promise<SigningProvider> {
  let mod: Record<string, unknown>;
  try {
    // Computed specifier: tsc must NOT resolve this statically — the module
    // is owned by the signing worker and may not exist yet. At runtime the
    // real import is attempted and a missing module becomes a clear error.
    const specifier = "../signing/mpc.js";
    mod = (await import(specifier)) as Record<string, unknown>;
  } catch (err: any) {
    throw new Error(
      `Live MPC signer not available: src/signing/mpc.ts could not be loaded (${err?.message ?? err}). ` +
        `The signing module is still being built — run with --dry-run to exercise the flow, ` +
        `or wait for the signing worker to land src/signing/mpc.ts.`,
    );
  }
  if (typeof mod.createMpcSigner === "function") {
    return (mod.createMpcSigner as (a: string) => Promise<SigningProvider>)(accountId);
  }
  if (typeof mod.MpcSigner === "function") {
    const Ctor = mod.MpcSigner as new (a: string) => SigningProvider;
    return new Ctor(accountId);
  }
  const candidate = mod.mpcSigner as SigningProvider | undefined;
  if (
    candidate &&
    typeof candidate.deriveAddress === "function" &&
    typeof candidate.sign === "function"
  ) {
    return candidate;
  }
  // Fallback adapter over the landed mpc.ts exports (see doc comment above).
  if (
    typeof mod.createMpcContract === "function" &&
    typeof mod.deriveAddressViaMpc === "function" &&
    typeof mod.signPayload === "function" &&
    typeof mod.getNearCredentials === "function" &&
    typeof mod.createNearAccount === "function" &&
    typeof mod.createSignerAccount === "function"
  ) {
    const createMpcContract = mod.createMpcContract as (
      networkId: string,
    ) => unknown;
    const deriveAddressViaMpc = mod.deriveAddressViaMpc as (
      contract: unknown,
      accountId: string,
      path: string,
    ) => Promise<{ address: string }>;
    const signPayload = mod.signPayload as (
      contract: unknown,
      signerAccount: unknown,
      payload: Uint8Array,
      path: string,
    ) => Promise<{ signatures: { r: string; s: string; v: number }[] }>;
    const getNearCredentials = mod.getNearCredentials as () => {
      accountId: string;
      privateKey: string;
    };
    const createNearAccount = mod.createNearAccount as (
      accountId: string,
      privateKey: string,
      networkId: string,
    ) => unknown;
    const createSignerAccount = mod.createSignerAccount as (
      account: unknown,
    ) => unknown;
    const contract = createMpcContract("testnet");
    const hex32 = (h: string) => "0x" + h.replace(/^0x/, "").padStart(64, "0");
    return {
      deriveAddress: async (acct: string, path: string) =>
        (await deriveAddressViaMpc(contract, acct, path)).address,
      sign: async (payload: Uint8Array, path: string) => {
        const creds = getNearCredentials(); // throws a clear error when the key is missing
        if (creds.accountId !== accountId) {
          throw new Error(
            `NEAR_ACCOUNT_ID mismatch: demo asked for ${accountId} but .env.local has ${creds.accountId}.`,
          );
        }
        const account = createNearAccount(creds.accountId, creds.privateKey, "testnet");
        const signerAccount = createSignerAccount(account);
        const { signatures } = await signPayload(contract, signerAccount, payload, path);
        const sig = signatures[0];
        if (!sig) throw new Error("MPC returned no signature.");
        return { r: hex32(sig.r), s: hex32(sig.s), v: sig.v };
      },
    };
  }
  throw new Error(
    "Live MPC signer loaded but does not satisfy the SigningProvider seam: " +
      "expected a `createMpcSigner(accountId)` factory, a default `MpcSigner` class, " +
      "or an `mpcSigner` object with deriveAddress()/sign(). See src/agent/types.ts.",
  );
}

/** Build the unsigned mint tx + its EIP-155 signing hash (type-0 legacy tx).
 *  Exported for offline tests — the sign/broadcast happy path has no live
 *  SAFE contract to exercise it against right now.
 *  NOTE: this builder serves sign mode and dry-run full only. Live full
 *  does NOT use it (see the live-full branch in main()): the adapter
 *  prepares the real tx from chain state instead. */
export function buildMintTx(
  verdict: VettingVerdict,
  opts: { chainId: number; dryRun: boolean },
): { tx: ethers.Transaction; signingHash: string; calldata: string } {
  // Calldata for the simulated mint function (shared builder in
  // live-full.ts). Unknown shapes -> "0x": the tx is still signable,
  // but the mint would not execute; the demo says so.
  const calldata = buildMintCalldata(verdict.simulatedFunction);
  const tx = ethers.Transaction.from({
    type: 0,
    chainId: opts.chainId,
    to: verdict.contract,
    value: 0n,
    data: calldata,
    // Dry-run placeholders (never broadcast): nonce 0, 1 gwei gas price.
    // Live broadcast fills real nonce/gas from the chain before signing.
    nonce: 0,
    gasLimit: 200_000,
    gasPrice: 1_000_000_000n,
  });
  return { tx, signingHash: tx.unsignedHash, calldata };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.ca || !/^0x[0-9a-fA-F]{40}$/.test(args.ca)) {
    console.error("Error: --ca <0x...40 hex chars> is required.");
    console.error(usage());
    process.exit(1);
  }
  const accountId = args.account ?? process.env.NEAR_ACCOUNT_ID ?? "mintguard.testnet";
  if (args.mode === "full" && !args.confirmTestnet) {
    console.error(
      "Error: mode full broadcasts a transaction — pass --confirm-testnet to confirm " +
        "you intend a BSC TESTNET (chainId 97) mint. Testnet only, always.",
    );
    process.exit(1);
  }
  if ((args.mode === "sign" || args.mode === "full") && !args.dryRun && !process.env.NEAR_ACCOUNT_ID && !args.account) {
    console.error(
      "Error: live signing needs a NEAR account — set NEAR_ACCOUNT_ID in .env.local " +
        "or pass --account <account.testnet>. No key was found, so nothing was signed. " +
        "Use --dry-run to exercise the flow without a NEAR account.",
    );
    process.exit(1);
  }

  const steps: StepLog[] = [];
  const log = (step: string, ms: number, ok: boolean, detail: string) => {
    steps.push({ step, ms, ok, detail });
    console.log(`[${ok ? "ok " : "FAIL"}] ${step} (${ms}ms) — ${detail}`);
  };

  console.log(`MintGuard demo — mode=${args.mode}${args.dryRun ? " (DRY-RUN)" : ""} — contract ${args.ca}`);
  if (args.dryRun) {
    console.log("DRY-RUN: signatures and tx hashes below are FAKE and clearly marked — nothing is broadcast.");
  }

  // --- Step 1: VET (read-only; never sends a tx) ---
  // The vetting chain MUST match the chain the contract lives on. sign/full
  // broadcast to BSC testnet (97), so they vet on the bsc-testnet adapter;
  // vetting a testnet-only address through the mainnet adapter reads "no
  // code" on the wrong chain and verdicts NOT_MINT. Vet mode keeps the
  // mainnet default (it vets arbitrary real-world drops). --chain overrides.
  const vetChain =
    args.chain ?? (args.mode === "sign" || args.mode === "full" ? "bsc-testnet" : "bsc");
  let verdict: VettingVerdict;
  try {
    const { result, ms } = await timed("vet", () =>
      vetContract(args.ca!, { chain: vetChain, walletAddress: args.wallet }),
    );
    verdict = result;
    log("vet", ms, true, `verdict ${verdict.verdict} (score ${verdict.score}, chain ${verdict.chain}, simulation ${verdict.simulationOk ? "ok" : "FAILED"})`);
  } catch (err: any) {
    log("vet", 0, false, `vetting failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  // Record the vetting in the ledger (every mode, including vet-only).
  const vetEntry = makeEntry({
    kind: "vetting",
    contract: verdict.contract,
    chain: verdict.chain,
    verdict: verdict.verdict,
    score: verdict.score,
    agentAccount: accountId,
    derivedAddress: args.wallet ?? "unknown",
    notes: args.dryRun ? "demo --dry-run" : `demo mode=${args.mode}`,
  });

  // Vet-only mode ends here: no signing, no key, no broadcast.
  if (args.mode === "vet") {
    appendEntry(vetEntry, args.ledgerPath);
    log("record", 0, true, `vetting appended to ledger (${args.ledgerPath})`);
    console.log(JSON.stringify({ mode: "vet", dryRun: args.dryRun, verdict, steps }, null, 2));
    return;
  }

  // --- Step 2: POLICY GATE (broadcast target is always BSC testnet, 97) ---
  const policy = checkPolicy(verdict, {
    chainId: BSC_TESTNET_CHAIN_ID,
    mintValueWei: verdict.mintPriceWei ?? undefined,
    estimatedGasWei: args.dryRun ? DRY_RUN_GAS_WEI : undefined,
    maxGasWei: DEFAULT_MAX_GAS_WEI,
    humanApprovedExact: args.humanApprovedExact,
  });
  for (const c of policy.checks) {
    console.log(`  policy [${c.passed ? "pass" : "FAIL"}] ${c.name}: ${c.detail}`);
  }
  if (!policy.allowed) {
    log("policy", 0, false, policy.reason);
    // Record the refusal too — a refused mint is reputation data.
    appendEntry(
      { ...vetEntry, notes: `policy BLOCKED execution: ${policy.reason}` },
      args.ledgerPath,
    );
    console.log(JSON.stringify({ mode: args.mode, dryRun: args.dryRun, verdict, policy, steps }, null, 2));
    process.exit(1);
  }
  log("policy", 0, true, policy.reason);

  // --- Step 3: DERIVE the agent's EVM address from its NEAR account ---
  // The signer is the authority on derivation (offline math in live mode,
  // deterministic placeholder in dry-run mode).
  const signer: SigningProvider = args.dryRun
    ? new DryRunSigner()
    : await loadLiveSigner(accountId);
  let derivedAddress: string;
  try {
    const { result, ms } = await timed("derive", () => signer.deriveAddress(accountId, args.path));
    derivedAddress = result;
    log("derive", ms, true, `NEAR ${accountId} (path ${args.path}) -> EVM ${derivedAddress}`);
  } catch (err: any) {
    log("derive", 0, false, err?.message ?? String(err));
    process.exit(1);
  }

  // Record vetting with the real derived address now that we know it.
  appendEntry({ ...vetEntry, derivedAddress }, args.ledgerPath);
  log("record", 0, true, `vetting appended to ledger (${args.ledgerPath})`);

  // --- Step 4 (full-live only): ADAPTER FLOW via live-full.ts ---
  // Live full does NOT use the generic sign/broadcast path below: that
  // path signs a locally-built legacy tx (placeholder nonce 0, 1 gwei)
  // whose signature can never broadcast. The live mint is prepared
  // against chain state by the chainsig EVM adapter, then MPC-signed,
  // finalized, broadcast, receipt-checked and ownerOf-verified inside
  // runLiveFullMint — with every guard (testnet-only, tBNB, gas
  // ceiling, recovery, receipt, ownership) running before the step it
  // protects. A tBNB balance of 0 fails here with faucet instructions.
  if (args.mode === "full" && !args.dryRun) {
    try {
      const liveDeps = await createLiveFullDeps(accountId, args.path);
      const { result, ms } = await timed("live-full", () =>
        runLiveFullMint(liveDeps, {
          verdict,
          derivedAddress,
          policy: {
            mintValueWei: verdict.mintPriceWei ?? undefined,
            maxGasWei: DEFAULT_MAX_GAS_WEI,
            humanApprovedExact: args.humanApprovedExact,
          },
        }),
      );
      log(
        "live-full",
        ms,
        true,
        `broadcast ${result.txHash} — token #${result.tokenId} ownerOf OK (${result.explorerTxUrl})`,
      );
      appendEntry(
        makeEntry({
          kind: "mint",
          contract: verdict.contract,
          chain: "bsc-testnet",
          verdict: verdict.verdict,
          score: verdict.score,
          agentAccount: accountId,
          derivedAddress,
          txHash: result.txHash,
          receipt: `success block=${result.receipt.blockNumber} gasUsed=${result.receipt.gasUsed}`,
          notes: `demo mode=full live — token #${result.tokenId}`,
        }),
        args.ledgerPath,
      );
      log("record", 0, true, `mint appended to ledger (${args.ledgerPath})`);
      console.log(
        JSON.stringify(
          {
            mode: "full",
            dryRun: false,
            verdict,
            derivedAddress,
            txHash: result.txHash,
            tokenId: result.tokenId.toString(),
            steps,
          },
          null,
          2,
        ),
      );
      return;
    } catch (err: any) {
      log("live-full", 0, false, err?.message ?? String(err));
      process.exit(1);
    }
  }

  // --- Step 4 (sign mode + dry-run full): SIGN the mint payload ---
  const { tx, signingHash, calldata } = buildMintTx(verdict, {
    chainId: BSC_TESTNET_CHAIN_ID,
    dryRun: args.dryRun,
  });
  console.log(`  mint calldata: ${calldata} (to ${verdict.contract}, value 0, chainId 97)`);
  let sig;
  try {
    const { result, ms } = await timed("sign", () =>
      signer.sign(ethers.getBytes(signingHash), args.path),
    );
    sig = result;
    log(
      "sign",
      ms,
      true,
      args.dryRun
        ? `DRY-RUN fake signature r=${sig.r.slice(0, 18)}… v=${sig.v} — NOT an MPC signature`
        : `MPC signature r=${sig.r.slice(0, 18)}… v=${sig.v}`,
    );
  } catch (err: any) {
    log("sign", 0, false, `signing failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  if (args.mode === "sign") {
    tx.signature = sig;
    console.log(`  signed raw tx (NOT broadcast): ${tx.serialized.slice(0, 66)}…`);
    console.log(JSON.stringify({ mode: "sign", dryRun: args.dryRun, verdict, derivedAddress, signingHash, signature: sig, steps }, null, 2));
    return;
  }

  // --- Step 5 (full only, dry-run): BROADCAST + record mint ---
  // Live full returned earlier (live-full branch above); only the
  // dry-run path reaches here, with the fake broadcaster.
  const broadcaster: BroadcastProvider = new DryRunBroadcaster();
  tx.signature = sig;
  const signedSerialized = tx.serialized;
  let txHash: string;
  try {
    const { result, ms } = await timed("broadcast", () => broadcaster.broadcast(signedSerialized));
    txHash = result.txHash;
    log(
      "broadcast",
      ms,
      true,
      args.dryRun ? `DRY-RUN fake txHash ${txHash} — nothing broadcast` : `broadcast tx ${txHash}`,
    );
  } catch (err: any) {
    log("broadcast", 0, false, `broadcast failed: ${err?.message ?? err}`);
    process.exit(1);
  }

  appendEntry(
    makeEntry({
      kind: "mint",
      contract: verdict.contract,
      chain: "bsc-testnet",
      verdict: verdict.verdict,
      score: verdict.score,
      agentAccount: accountId,
      derivedAddress,
      txHash,
      receipt: args.dryRun ? "DRY-RUN — no on-chain transaction" : "broadcast, awaiting confirmation",
      notes: args.dryRun ? "demo --dry-run --confirm-testnet" : "demo mode=full --confirm-testnet",
    }),
    args.ledgerPath,
  );
  log("record", 0, true, `mint appended to ledger (${args.ledgerPath})`);

  console.log(
    JSON.stringify(
      { mode: "full", dryRun: args.dryRun, verdict, derivedAddress, txHash, steps },
      null,
      2,
    ),
  );
}

// Only run as a CLI when executed directly (tsx src/agent/demo.ts) —
// importing this module from tests must not start the demo.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/agent/demo.ts")) {
  main().catch((err: any) => {
    console.error(`Demo failed: ${err?.message ?? err}`);
    process.exit(1);
  });
}
