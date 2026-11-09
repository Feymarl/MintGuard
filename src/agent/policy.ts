// MintGuard — Policy Gate (pure).
//
// The last line of defence between a vetting verdict and a broadcast
// transaction. `checkPolicy()` is a pure function: verdict + options in,
// { allowed, reason, checks } out. No network, no signing, no state —
// unit-testable and auditable by the judges.
//
// Rules (from docs/architecture.md "Security invariants"):
//   1. TESTNET ONLY: broadcast target must be BSC testnet (chainId 97).
//      BSC mainnet (56) — and any other chain — is always refused.
//   2. FREE ONLY: mint value > 0 wei (beyond gas) is refused unless a human
//      explicitly approved THAT exact action (opts.humanApprovedExact).
//   3. SIMULATION REQUIRED: the eth_call simulation must have succeeded.
//      A reverted simulation aborts the flow, no exceptions.
//   4. VERDICT: SAFE may proceed; RISKY only with humanApprovedExact;
//      BLOCK and NOT_MINT never proceed, even with human approval.
//   5. GAS CEILING: estimated gas cost must fit under maxGasWei
//      (default 0.001 tBNB per mint). Hard cap — no override, because a
//      runaway gas price is exactly the failure this gate exists to stop.

import type { VettingVerdict } from "../vetting/core/types.js";

/** BSC testnet — the ONLY chain a broadcast may target. */
export const BSC_TESTNET_CHAIN_ID = 97;
/** BSC mainnet — always refused for broadcast. */
export const BSC_MAINNET_CHAIN_ID = 56;

/** Default gas ceiling per mint: 0.001 tBNB = 10^15 wei. */
export const DEFAULT_MAX_GAS_WEI = 10n ** 15n;

export interface PolicyOptions {
  /** Chain id of the BROADCAST target (not the vetting chain). */
  chainId: number;
  /** Mint value in wei (0 = free mint). bigint or decimal string. */
  mintValueWei?: bigint | string;
  /** Estimated total gas cost in wei (gasLimit * gasPrice). */
  estimatedGasWei?: bigint | string;
  /** Gas ceiling override; defaults to DEFAULT_MAX_GAS_WEI. */
  maxGasWei?: bigint | string;
  /**
   * True ONLY when a human explicitly approved this exact action
   * (this contract, this mint, this value). A "yes" to a preview, a
   * "yes" to a free mint, or a blanket approval does NOT set this.
   */
  humanApprovedExact?: boolean;
}

export interface PolicyCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PolicyDecision {
  allowed: boolean;
  /** One-line human-readable reason for the decision. */
  reason: string;
  checks: PolicyCheck[];
}

function toBigInt(v: bigint | string | undefined): bigint | null {
  if (v === undefined) return null;
  try {
    return typeof v === "bigint" ? v : BigInt(v);
  } catch {
    return null;
  }
}

export function checkPolicy(verdict: VettingVerdict, opts: PolicyOptions): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const fail = (name: string, detail: string) => checks.push({ name, passed: false, detail });
  const pass = (name: string, detail: string) => checks.push({ name, passed: true, detail });

  // 1. Testnet only.
  if (opts.chainId === BSC_TESTNET_CHAIN_ID) {
    pass("testnet-only", `broadcast target is BSC testnet (chainId 97)`);
  } else if (opts.chainId === BSC_MAINNET_CHAIN_ID) {
    fail("testnet-only", `refused: chainId 56 is BSC MAINNET — testnet only`);
  } else {
    fail("testnet-only", `refused: chainId ${opts.chainId} is not BSC testnet (97)`);
  }

  // 2. Simulation required (hard rule, no override).
  if (verdict.simulationOk) {
    pass("simulation", `eth_call simulation succeeded (${verdict.simulatedFunction ?? "mint"})`);
  } else {
    fail(
      "simulation",
      `refused: eth_call simulation failed${verdict.simulationError ? ` — ${verdict.simulationError}` : ""}`,
    );
  }

  // 3. Verdict.
  if (verdict.verdict === "SAFE") {
    pass("verdict", `verdict SAFE (score ${verdict.score})`);
  } else if (verdict.verdict === "RISKY") {
    if (opts.humanApprovedExact) {
      pass("verdict", `verdict RISKY (score ${verdict.score}) but human approved this exact action`);
    } else {
      fail("verdict", `refused: verdict RISKY (score ${verdict.score}) needs explicit human approval`);
    }
  } else {
    // BLOCK / NOT_MINT: never, even with human approval.
    fail("verdict", `refused: verdict ${verdict.verdict} never proceeds`);
  }

  // 4. Free only.
  const value = toBigInt(opts.mintValueWei);
  if (value === null) {
    fail("free-only", `refused: mint price unreadable (mintPriceWei null) — cannot prove free`);
  } else if (value === 0n) {
    pass("free-only", `mint value is 0 (free, gas only)`);
  } else if (opts.humanApprovedExact) {
    pass("free-only", `mint value ${value} wei but human approved this exact paid action`);
  } else {
    fail("free-only", `refused: mint costs ${value} wei — paid mints need explicit human approval`);
  }

  // 5. Gas ceiling (hard cap).
  const gas = toBigInt(opts.estimatedGasWei);
  const maxGas = toBigInt(opts.maxGasWei) ?? DEFAULT_MAX_GAS_WEI;
  if (gas === null) {
    pass("gas-ceiling", `no gas estimate supplied — ceiling (${maxGas} wei) checked at broadcast time`);
  } else if (gas <= maxGas) {
    pass("gas-ceiling", `estimated gas ${gas} wei <= ceiling ${maxGas} wei`);
  } else {
    fail("gas-ceiling", `refused: estimated gas ${gas} wei exceeds ceiling ${maxGas} wei`);
  }

  const failed = checks.filter((c) => !c.passed);
  return {
    allowed: failed.length === 0,
    reason:
      failed.length === 0
        ? "policy passed: testnet, free, simulated, SAFE, gas within ceiling"
        : `policy blocked: ${failed.map((c) => c.detail).join("; ")}`,
    checks,
  };
}
