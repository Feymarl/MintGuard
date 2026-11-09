// MintGuard — Vetting Core: function selectors.
// RULE: selectors are ALWAYS computed from the signature with keccak256
// (ethers.id), never hand-typed from memory. Hand-typed selectors are how
// the 0x817b1cd2 bug happened (that is NOT totalMinted).
// The one exception below is a TEST assertion: computed totalMinted()
// MUST equal 0xa2309ff8, the value verified on-chain.

import { ethers } from "ethers";

/** keccak256(signature) first 4 bytes, e.g. selector("mint(uint256)"). */
export function selector(signature: string): string {
  return ethers.id(signature).slice(0, 10);
}

/** Canonical read-function signatures the engine probes on any contract. */
export const READ_SIGNATURES = {
  totalSupply: "totalSupply()",
  totalMinted: "totalMinted()",
  maxSupply: "maxSupply()",
  remaining: "remaining()",
  mintPrice: "mintPrice()",
  price: "price()",
  cost: "cost()",
  paused: "paused()",
  owner: "owner()",
} as const;

/** EIP-1967 implementation slot. */
export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** Zero address used to detect "no implementation". */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Mint/claim function name patterns (case-insensitive substring match). */
export const MINT_NAME_PATTERN = /mint|claim/i;

/**
 * Is this ABI function name a plausible mint entry point?
 * - must contain "mint" or "claim"
 * - must NOT be an admin/getter lookalike: setMintOpen, freeClaimed,
 *   mintPrice, isMintOpen, etc. Those would fake a mint simulation.
 */
export function isMintCandidate(name: string): boolean {
  const lower = name.toLowerCase();
  if (!/(mint|claim)/.test(lower)) return false;
  if (/(set|get|claimed|claimable|open|price|pause|owner|admin|fee|royalt|uri|base)/.test(lower)) {
    return false;
  }
  return true;
}
