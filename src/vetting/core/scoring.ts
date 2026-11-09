// MintGuard — Vetting Core: pure scoring / verdict logic.
// 100% offline and deterministic: given a VettingInput it produces risks,
// a 0-100 score and a verdict. No network, no provider — unit-testable.
//
// Hard-block rules (verdict BLOCK, score capped at 19):
//   - contract has no code / is not a mint contract   -> NOT_MINT (score 0)
//   - unverified source                               -> BLOCK
//   - paused                                          -> BLOCK
//   - honeypot (GoPlus)                               -> BLOCK
//   - buy/sell tax > 10%                              -> BLOCK
//   - explicit hidden fee signal                      -> BLOCK
// Everything else only deducts points; score >= 80 -> SAFE, else RISKY.

import { ethers } from "ethers";
import type { Risk, TokenSecurity, VettingInput, VettingVerdict, VerdictKind } from "./types.js";
import { isMintCandidate } from "./selectors.js";

export interface ScoredOutput {
  risks: Risk[];
  score: number;
  verdict: VerdictKind;
}

const BLOCK_SCORE_CAP = 19;

function risk(code: string, message: string, severity: Risk["severity"]): Risk {
  return { code, message, severity };
}

/** Does the ABI expose any mint/claim function at all? */
export function hasMintFunction(abi: any[]): boolean {
  return abi.some(
    (e) =>
      e?.type === "function" &&
      typeof e.name === "string" &&
      isMintCandidate(e.name),
  );
}

/**
 * Is this mint PROVEN free (price exactly 0 wei)? True only when ALL hold:
 *   1. No mintPrice()/price()/cost() value is readable (price is null), AND
 *   2. the value-0 eth_call simulation of the mint function SUCCEEDED, AND
 *   3. the simulated function is NONPAYABLE in the verified ABI.
 *
 * A nonpayable function reverts on ANY nonzero value (EVM-enforced), so
 * a value-0 success proves the mint costs exactly 0 wei — this is
 * evidence, not a default. Without a successful simulation, or without
 * the nonpayable marker (e.g. a payable mint, or an unverified ABI),
 * the price stays null (unknown) and the policy gate still refuses it
 * as unprovable. The policy gate itself is NOT touched: it keeps
 * enforcing free-only against the value reported here.
 */
export function isProvenFreeMint(input: VettingInput): boolean {
  if (input.chain.mintPriceWei !== null) return false;
  if (!input.simulation.ok || !input.simulation.fn) return false;
  try {
    const frag = new ethers.Interface(input.sourcify.abi).getFunction(input.simulation.fn);
    return frag?.stateMutability === "nonpayable";
  } catch {
    return false;
  }
}

/**
 * Derive free-mint quota from on-chain counters.
 * LESSON (Chip404, 2026-11-08): totalSupply() is NOT remaining mints —
 * burned tokens inflate the gap. Only totalMinted()/remaining()/maxSupply()
 * may be used. Returns null when no quota signal exists.
 */
export function deriveFreeQuota(input: {
  remaining: number | null;
  totalMinted: number | null;
  maxSupply: number | null;
}): number | null {
  if (input.remaining !== null && input.remaining !== undefined) return input.remaining;
  if (input.totalMinted !== null && input.maxSupply !== null) {
    return Math.max(0, input.maxSupply - input.totalMinted);
  }
  return null;
}

export function scoreVetting(input: VettingInput): ScoredOutput {
  const risks: Risk[] = [];
  let score = 100;
  let hardBlock = false;

  const deduct = (pts: number, r: Risk) => {
    score -= pts;
    risks.push(r);
  };

  // --- 0. Is it even a contract / a mint contract? -----------------------
  if (!input.chain.hasCode) {
    return {
      risks: [risk("no_code", "Address has no contract code.", "block")],
      score: 0,
      verdict: "NOT_MINT",
    };
  }
  if (!hasMintFunction(input.sourcify.abi)) {
    return {
      risks: [
        risk(
          "not_mint",
          "No mint/claim function in the contract ABI — this is not a mint contract.",
          "block",
        ),
      ],
      score: 0,
      verdict: "NOT_MINT",
    };
  }

  // --- 1. Verification ----------------------------------------------------
  if (!input.sourcify.verified) {
    hardBlock = true;
    deduct(100, risk("unverified", "Contract source is NOT verified on Sourcify.", "block"));
  } else if (!input.sourcify.exactMatch) {
    deduct(10, risk("partial_match", "Source verified but only a partial match.", "warn"));
  }

  // --- 2. Proxy -----------------------------------------------------------
  if (input.sourcify.isProxy || input.chain.implementationSlot) {
    deduct(
      5,
      risk(
        "proxy",
        `EIP-1967 proxy — logic lives in implementation ${input.sourcify.implementation ?? input.chain.implementationSlot ?? "unknown"}. Vet the implementation too.`,
        "warn",
      ),
    );
  }

  // --- 3. Paused ----------------------------------------------------------
  if (input.chain.paused === true) {
    hardBlock = true;
    deduct(100, risk("paused", "Contract is paused — minting is disabled.", "block"));
  }

  // --- 4. Price / hidden fee ----------------------------------------------
  const price = input.chain.mintPriceWei;
  if (price !== null && price > 0n) {
    deduct(
      25,
      risk(
        "paid_mint",
        `Mint is NOT free: price is ${price.toString()} wei. MintGuard only auto-mints gas-only drops.`,
        "warn",
      ),
    );
  } else if (price === null && isProvenFreeMint(input)) {
    // No readable price getter, but the mint is PROVEN free (see
    // isProvenFreeMint): record the evidence in-band so the verdict
    // shows why mintPriceWei is reported as "0" instead of null.
    risks.push(
      risk(
        "price_inferred_free",
        "No mintPrice()/price()/cost() readable; the simulated mint function is nonpayable and the value-0 simulation succeeded, so the mint provably costs 0 wei (a nonpayable function reverts on any nonzero value).",
        "info",
      ),
    );
  }

  // --- 5. Quota -----------------------------------------------------------
  const quota = deriveFreeQuota(input.chain);
  if (quota !== null && quota <= 0) {
    deduct(
      40,
      risk("sold_out", "Free quota exhausted (totalMinted == maxSupply / remaining == 0).", "warn"),
    );
  }

  // --- 6. Simulation ------------------------------------------------------
  if (!input.simulation.fn) {
    deduct(15, risk("no_simulation", "No mint function could be simulated (no callable candidate).", "warn"));
  } else if (!input.simulation.ok) {
    deduct(
      30,
      risk(
        "simulation_revert",
        `eth_call simulation of ${input.simulation.fn} reverted: ${input.simulation.error ?? "unknown reason"}. Mint may be gated (PoW, allowlist, window) or closed.`,
        "warn",
      ),
    );
  }

  // --- 7. Token security (GoPlus or equivalent) ---------------------------
  const ts: TokenSecurity | null = input.tokenSecurity;
  if (ts) {
    if (ts.isHoneypot === true) {
      hardBlock = true;
      deduct(100, risk("honeypot", "GoPlus flags this token as a honeypot.", "block"));
    }
    const maxTax = Math.max(ts.buyTax ?? 0, ts.sellTax ?? 0);
    if (maxTax > 10) {
      hardBlock = true;
      deduct(100, risk("high_tax", `Token tax is ${maxTax}% (> 10%) — likely a fee trap.`, "block"));
    } else if (maxTax > 5) {
      deduct(25, risk("elevated_tax", `Token tax is ${maxTax}% (> 5%).`, "warn"));
    }
    if (ts.ownerRenounced === false) {
      deduct(5, risk("owner_not_renounced", "Token owner is not renounced.", "info"));
    }
  }

  // --- Final verdict ------------------------------------------------------
  score = Math.max(0, Math.min(100, score));
  let verdict: VerdictKind;
  if (hardBlock) {
    verdict = "BLOCK";
    score = Math.min(score, BLOCK_SCORE_CAP);
  } else if (score >= 80) {
    verdict = "SAFE";
  } else {
    verdict = "RISKY";
  }

  return { risks, score, verdict };
}

/** Assemble the full JSON verdict object from a VettingInput. */
export function buildVerdict(
  input: VettingInput,
  chainKey: string,
  chainId: number,
): VettingVerdict {
  const { risks, score, verdict } = scoreVetting(input);
  const quota = deriveFreeQuota(input.chain);
  // Proven-free mints (no price getter, nonpayable sim success) report
  // mintPriceWei "0" — see isProvenFreeMint. Otherwise the raw read
  // (a value, or null when unknown/unreadable).
  const mintPriceWei = isProvenFreeMint(input)
    ? "0"
    : input.chain.mintPriceWei !== null
      ? input.chain.mintPriceWei.toString()
      : null;
  return {
    contract: input.contract,
    chain: chainKey,
    chainId,
    verified: input.sourcify.verified,
    exactMatch: input.sourcify.exactMatch,
    isProxy: Boolean(input.sourcify.isProxy || input.chain.implementationSlot),
    implementation: input.sourcify.implementation ?? input.chain.implementationSlot ?? null,
    mintPriceWei,
    freeQuotaRemaining: quota,
    totalMinted: input.chain.totalMinted,
    maxSupply: input.chain.maxSupply,
    simulationOk: input.simulation.ok,
    simulationError: input.simulation.error,
    simulatedFunction: input.simulation.fn,
    risks,
    score,
    verdict,
  };
}
