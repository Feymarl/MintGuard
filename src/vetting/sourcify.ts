// MintGuard — Adapter layer: Sourcify v2 API client (chain-agnostic).
// RULE: always query with a LOWERCASE address. A mixed-case EIP-55 address
// makes Sourcify answer "Invalid address".

import type { SourcifyResult } from "./core/types.js";

export const SOURCIFY_BASE = "https://sourcify.dev/server/v2/contract";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchSourcify(
  sourcifyChainId: number,
  address: string,
): Promise<SourcifyResult> {
  const lower = address.toLowerCase();
  const url = `${SOURCIFY_BASE}/${sourcifyChainId}/${lower}?fields=abi,sources`;
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (res.status === 404) {
    return { verified: false, exactMatch: false, contractName: null, abi: [] };
  }
  if (!res.ok) {
    throw new Error(`Sourcify request failed: HTTP ${res.status}`);
  }
  const body: any = await res.json();
  const abi = Array.isArray(body?.abi) ? body.abi : [];
  return {
    verified: body?.match === "exact_match" || body?.match === "partial_match",
    exactMatch: body?.match === "exact_match",
    contractName: body?.name ?? body?.stdJson?.settings?.outputSelection ?? null,
    abi,
  };
}
