// MintGuard — BSC Testnet adapter (chainId 97).
// Same chain family as BSC mainnet, but a SEPARATE adapter: different RPC
// endpoints, different Sourcify chain id, and NO GoPlus support.
//
// GoPlus token_security does NOT cover chain 97. That is handled by
// OMISSION, not by a fake: goplusChainId is unset and getTokenSecurity
// is absent, so the engine treats token security as "no signal"
// (tokenSecurity null) — it never fails the vet, and no request is ever
// sent to GoPlus for an unsupported chain. A testnet NFT contract has
// no token to screen anyway; the on-chain reads + simulation + Sourcify
// verification carry the verdict.
//
// RPC order: the endpoints that answer from this box first (drpc.org and
// data-seed-prebsc-1-s3, verified live), then the official dataseed
// endpoints the signing path (src/signing/broadcast.ts) already uses.

import type { ChainAdapter } from "../core/types.js";

export const bscTestnetAdapter: ChainAdapter = {
  key: "bsc-testnet",
  name: "BNB Smart Chain Testnet",
  chainId: 97,
  rpcUrls: [
    "https://bsc-testnet.drpc.org",
    "https://data-seed-prebsc-1-s3.bnbchain.org:8545",
    "https://data-seed-prebsc-1-s1.binance.org:8545",
    "https://bsc-testnet-dataseed.bnbchain.org",
    "https://bsc-testnet-rpc.publicnode.com",
    "https://bnb-testnet.api.onfinality.io/public",
  ],
  sourcifyChainId: 97,
  // goplusChainId intentionally omitted: GoPlus does not support chain 97.
  // No getTokenSecurity on purpose — see the header comment.
};

/** Re-exported for symmetry with bsc.ts; the registry lives there. */
export const BSC_TESTNET_KEY = "bsc-testnet";
