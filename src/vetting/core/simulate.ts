// MintGuard — Vetting Core: eth_call mint simulation (read-only).
// Given a provider + ABI, finds mint/claim candidates, builds calldata from
// the ABI (selectors computed via ethers, never hand-typed), and runs
// eth_call with from=<wallet> and value=0. No transaction is ever sent.

import { ethers } from "ethers";
import { isMintCandidate } from "./selectors.js";

export interface SimulationResult {
  ok: boolean;
  error: string | null;
  /** Canonical signature of the function that was tried, e.g. "mint(uint256)". */
  fn: string | null;
}

const DEFAULT_FROM = "0x0000000000000000000000000000000000000000";

/** Build placeholder args for a mint function so eth_call can run offline
 *  of any real user intent: address -> wallet, uint quantity -> 1, else 0. */
export function placeholderArgs(
  fn: ethers.FunctionFragment,
  wallet: string,
): any[] {
  return fn.inputs.map((param) => {
    const t = param.type;
    if (t === "address") return wallet;
    if (t.startsWith("uint") || t.startsWith("int")) {
      return /amount|quantity|count|number/i.test(param.name) ? 1n : 0n;
    }
    if (t === "bool") return false;
    if (t === "bytes32") return ethers.ZeroHash;
    if (t === "bytes") return "0x";
    if (t === "string") return "";
    if (t.endsWith("[]")) return [];
    return 0n;
  });
}

export async function simulateMintAt(
  provider: ethers.Provider,
  contract: string,
  abi: any[],
  walletAddress: string = DEFAULT_FROM,
): Promise<SimulationResult> {
  const iface = new ethers.Interface(abi);
  const candidates = iface.fragments
    .filter((f): f is ethers.FunctionFragment => f.type === "function")
    // Exclude view/pure getters: "freeClaimed()" contains "claim" but is a
    // counter, not a mint — simulating it would fake a successful mint.
    .filter((f) => f.stateMutability !== "view" && f.stateMutability !== "pure")
    .filter((f) => isMintCandidate(f.name));
  if (candidates.length === 0) {
    return { ok: false, error: "no mint/claim function in ABI", fn: null };
  }

  let lastError: string | null = null;
  let lastFn: string | null = null;
  for (const fn of candidates) {
    const sig = fn.format("sighash"); // e.g. "mint(uint256)"
    lastFn = sig;
    try {
      const calldata = iface.encodeFunctionData(fn, placeholderArgs(fn, walletAddress));
      await provider.call({ to: contract, data: calldata, from: walletAddress, value: 0n });
      return { ok: true, error: null, fn: sig };
    } catch (err: any) {
      lastError = shortRevertReason(err);
    }
  }
  return { ok: false, error: lastError, fn: lastFn };
}

/** Extract a short, human-readable revert reason from an ethers error. */
export function shortRevertReason(err: any): string {
  const msg: string =
    err?.reason ?? err?.error?.message ?? err?.message ?? String(err ?? "unknown error");
  // Trim ethers' verbose CALL_EXCEPTION wrapping.
  const m = msg.match(/reverted with reason string '([^']+)'/);
  if (m) return m[1];
  const m2 = msg.match(/execution reverted: ([^\n\]]+)/);
  if (m2) return m2[1];
  return msg.length > 200 ? msg.slice(0, 200) : msg;
}
