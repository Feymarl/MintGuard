// MintGuard — Vetting Core: safety heuristics.
// Pure helpers over data the adapter layer already fetched. The GoPlus HTTP
// call itself lives in the adapter (chain-specific chain id); this module
// only interprets the result and adds contract-level heuristics.

import type { TokenSecurity } from "./types.js";

/** Parse a GoPlus token_security v1 response body into TokenSecurity.
 *  Returns null when the response has no usable row (common for NFTs). */
export function parseGoPlusResponse(body: any, addressLower: string): TokenSecurity | null {
  const row = body?.result?.[addressLower];
  if (!row || typeof row !== "object") return null;
  const num = (v: any): number | null => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    isHoneypot: row.is_honeypot === "1" ? true : row.is_honeypot === "0" ? false : null,
    buyTax: num(row.buy_tax),
    sellTax: num(row.sell_tax),
    ownerRenounced:
      row.owner_address === "0x0000000000000000000000000000000000000000"
        ? true
        : row.owner_address
          ? false
          : null,
  };
}

/** Heuristic: does the ABI contain a payable mint with a non-zero price
 *  read that disagrees with a claimed "free" mint? Caller supplies both. */
export function detectHiddenFee(mintPriceWei: bigint | null, claimedFree: boolean): boolean {
  return claimedFree && mintPriceWei !== null && mintPriceWei > 0n;
}
