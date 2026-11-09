// MintGuard — BSC adapter (the first ChainAdapter).
// All BSC-specific knowledge lives here: RPC endpoints, Sourcify chain id
// (56), GoPlus chain id (56). The core engine consumes this adapter through
// the ChainAdapter interface — a new chain is a new file like this one.
//
// NOTE: BSC dataseed endpoints reject UA-less requests; the UA header is
// attached by the rpc.ts provider factory, not here.

import type { ChainAdapter, TokenSecurity } from "../core/types.js";
import { parseGoPlusResponse } from "../core/safety.js";
import { BROWSER_UA } from "../sourcify.js";

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1/token_security";

export async function fetchGoPlusBsc(address: string): Promise<TokenSecurity | null> {
  const lower = address.toLowerCase();
  const url = `${GOPLUS_BASE}/56?contract_addresses=${lower}`;
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) return null;
  const body: any = await res.json().catch(() => null);
  return parseGoPlusResponse(body, lower);
}

export const bscAdapter: ChainAdapter = {
  key: "bsc",
  name: "BNB Smart Chain",
  chainId: 56,
  rpcUrls: [
    "https://bsc-dataseed1.bnbchain.org",
    "https://bsc-dataseed2.bnbchain.org",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed.bnbchain.org",
  ],
  sourcifyChainId: 56,
  goplusChainId: 56,
  getTokenSecurity: fetchGoPlusBsc,
};

/** Adapter registry. New chains register here; the CLI picks by --chain. */
export const ADAPTERS: Record<string, ChainAdapter> = {
  bsc: bscAdapter,
};

export function getAdapter(chainKey: string): ChainAdapter {
  const adapter = ADAPTERS[chainKey.toLowerCase()];
  if (!adapter) {
    throw new Error(
      `Unknown chain "${chainKey}". Available: ${Object.keys(ADAPTERS).join(", ")}. ` +
        `Add a new adapter under src/vetting/adapters/ to support another chain.`,
    );
  }
  return adapter;
}
