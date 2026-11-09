// MintGuard — Adapter layer: ethers v6 JSON-RPC provider factory.
// RULE: BSC dataseed endpoints REJECT requests without a browser
// User-Agent. Every RPC request therefore carries a Chrome UA header via
// ethers.FetchRequest. The factory tries the adapter's RPC URLs in order
// and returns the first provider that answers eth_blockNumber.

import { ethers } from "ethers";
import type { ChainAdapter } from "./core/types.js";
import { BROWSER_UA } from "./sourcify.js";

export function buildProvider(adapter: ChainAdapter): ethers.JsonRpcProvider {
  const url = adapter.rpcUrls[0];
  const req = new ethers.FetchRequest(url);
  req.setHeader("User-Agent", BROWSER_UA);
  req.timeout = 15_000;
  return new ethers.JsonRpcProvider(req, adapter.chainId, { staticNetwork: true });
}

/** Try each RPC URL until one answers; throws when none respond. */
export async function buildLiveProvider(adapter: ChainAdapter): Promise<ethers.JsonRpcProvider> {
  let lastErr: any = null;
  for (const url of adapter.rpcUrls) {
    try {
      const req = new ethers.FetchRequest(url);
      req.setHeader("User-Agent", BROWSER_UA);
      req.timeout = 15_000;
      const provider = new ethers.JsonRpcProvider(req, adapter.chainId, { staticNetwork: true });
      await provider.getBlockNumber();
      return provider;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `No ${adapter.name} RPC reachable (${adapter.rpcUrls.join(", ")}): ${lastErr?.message ?? lastErr}`,
  );
}
