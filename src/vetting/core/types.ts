// MintGuard — Vetting Core: chain-agnostic types.
// The core knows NOTHING about BSC, Sourcify, or GoPlus. A ChainAdapter
// (see src/vetting/adapters/) supplies chain-specific endpoints and
// security providers. Adding a new chain = new adapter, zero core changes.

export type VerdictKind = "SAFE" | "RISKY" | "BLOCK" | "NOT_MINT";

export interface Risk {
  /** Machine-readable code, e.g. "unverified", "paused", "honeypot". */
  code: string;
  /** Human-readable explanation. */
  message: string;
  severity: "info" | "warn" | "block";
}

export interface VettingVerdict {
  contract: string;
  chain: string;
  chainId: number;
  verified: boolean;
  exactMatch: boolean;
  /** True when the contract is an EIP-1967 proxy. */
  isProxy: boolean;
  /** Implementation address when isProxy, else null. */
  implementation: string | null;
  /** Mint price in wei as a decimal string, null when unknown / not readable. */
  mintPriceWei: string | null;
  /** Free mints left, null when the contract exposes no quota signal. */
  freeQuotaRemaining: number | null;
  totalMinted: number | null;
  maxSupply: number | null;
  /** True when an eth_call simulation of a mint function succeeded. */
  simulationOk: boolean;
  /** Revert reason / error from the simulation, null on success. */
  simulationError: string | null;
  /** Which mint function was simulated, e.g. "mint(uint256)". */
  simulatedFunction: string | null;
  risks: Risk[];
  /** 0-100. Hard blocks cap the score at 19. */
  score: number;
  verdict: VerdictKind;
}

/** Minimal Sourcify result passed from the adapter layer into the core. */
export interface SourcifyResult {
  verified: boolean;
  exactMatch: boolean;
  contractName: string | null;
  /** Parsed ABI (empty array when unverified). */
  abi: any[];
  /** True when the contract looks like an EIP-1967 proxy. */
  isProxy?: boolean;
  implementation?: string | null;
}

/** On-chain read snapshot gathered by the adapter layer. */
export interface ChainReadSnapshot {
  hasCode: boolean;
  totalMinted: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  /** Explicit remaining() when the contract exposes it. */
  remaining: number | null;
  mintPriceWei: bigint | null;
  paused: boolean | null;
  owner: string | null;
  /** Raw EIP-1967 implementation slot value (zero address when not a proxy). */
  implementationSlot: string | null;
}

/** Token-security signal, e.g. from GoPlus. All fields optional: the
 *  provider may return nothing for an NFT contract. */
export interface TokenSecurity {
  isHoneypot: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  ownerRenounced: boolean | null;
  isProxy?: boolean | null;
}

/** Everything the core engine needs to vet one contract. Supplied by the
 *  adapter layer (which does the network I/O) or by tests (offline). */
export interface VettingInput {
  contract: string;
  walletAddress?: string;
  sourcify: SourcifyResult;
  chain: ChainReadSnapshot;
  tokenSecurity: TokenSecurity | null;
  simulation: { ok: boolean; error: string | null; fn: string | null };
}

/**
 * A chain adapter: the ONLY place chain-specific knowledge lives.
 * Core calls these; adapters implement them per chain.
 */
export interface ChainAdapter {
  /** Short key used by the CLI, e.g. "bsc". */
  key: string;
  /** Display name, e.g. "BNB Smart Chain". */
  name: string;
  chainId: number;
  /** RPC endpoints tried in order. Must accept a browser User-Agent. */
  rpcUrls: string[];
  /** Chain id used against the Sourcify v2 API. */
  sourcifyChainId: number;
  /** Chain id used against the GoPlus token_security API, if supported. */
  goplusChainId?: number;
  /** Fetch token security for an address; null when unavailable/unsupported. */
  getTokenSecurity?(address: string): Promise<TokenSecurity | null>;
}
