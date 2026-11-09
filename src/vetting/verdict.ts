// MintGuard — Vetting entry point.
// vetContract(address, { chain, walletAddress }) vets one contract through
// the chain adapter (default: BSC) and returns the JSON verdict.
// Read-only: only eth_call / getCode / getStorage / HTTP GET. Never sends
// a transaction.

import type { VettingVerdict } from "./core/types.js";
import { vetContractWithAdapter } from "./core/engine.js";
import { fetchSourcify } from "./sourcify.js";
import { buildLiveProvider } from "./rpc.js";
import { getAdapter } from "./adapters/bsc.js";

export interface VetOptions {
  /** Chain key, e.g. "bsc". Default "bsc". */
  chain?: string;
  /** Wallet the mint would be simulated from. Optional. */
  walletAddress?: string;
}

export async function vetContract(
  address: string,
  opts: VetOptions = {},
): Promise<VettingVerdict> {
  const adapter = getAdapter(opts.chain ?? "bsc");
  const provider = await buildLiveProvider(adapter);
  return vetContractWithAdapter(
    adapter,
    address,
    { fetchSourcify, buildProvider: () => provider },
    opts.walletAddress,
  );
}

export { getAdapter };
