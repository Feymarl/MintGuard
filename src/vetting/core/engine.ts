// MintGuard — Vetting Core: the generic vetting engine.
// Orchestrates Sourcify + on-chain reads + simulation + token security
// through a ChainAdapter. The core never hardcodes a chain, an RPC URL,
// or a security provider — adapters inject all of that.

import { ethers } from "ethers";
import type {
  ChainAdapter,
  ChainReadSnapshot,
  SourcifyResult,
  TokenSecurity,
  VettingInput,
  VettingVerdict,
} from "./types.js";
import { buildVerdict } from "./scoring.js";
import { simulateMintAt } from "./simulate.js";
import { EIP1967_IMPLEMENTATION_SLOT, READ_SIGNATURES, ZERO_ADDRESS, selector } from "./selectors.js";

export interface EngineDeps {
  /** Fetch Sourcify verification for (chainId, address). Injected so tests
   *  can stub it; the real implementation lives in src/vetting/sourcify.ts. */
  fetchSourcify: (sourcifyChainId: number, address: string) => Promise<SourcifyResult>;
  /** Build an ethers provider for the adapter's RPC list. */
  buildProvider: (adapter: ChainAdapter) => ethers.Provider;
}

/** Read a single uint256 view function via eth_call; null when the call
 *  reverts / the function does not exist. Selector computed from signature. */
export async function readUint(
  provider: ethers.Provider,
  contract: string,
  signature: string,
): Promise<number | null> {
  try {
    const data = selector(signature);
    const raw = await provider.call({ to: contract, data });
    if (!raw || raw === "0x") return null;
    return Number(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], raw)[0]);
  } catch {
    return null;
  }
}

export async function readUintBig(
  provider: ethers.Provider,
  contract: string,
  signature: string,
): Promise<bigint | null> {
  try {
    const data = selector(signature);
    const raw = await provider.call({ to: contract, data });
    if (!raw || raw === "0x") return null;
    return ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], raw)[0] as bigint;
  } catch {
    return null;
  }
}

export async function readBool(
  provider: ethers.Provider,
  contract: string,
  signature: string,
): Promise<boolean | null> {
  try {
    const data = selector(signature);
    const raw = await provider.call({ to: contract, data });
    if (!raw || raw === "0x") return null;
    return ethers.AbiCoder.defaultAbiCoder().decode(["bool"], raw)[0] as boolean;
  } catch {
    return null;
  }
}

export async function readAddress(
  provider: ethers.Provider,
  contract: string,
  signature: string,
): Promise<string | null> {
  try {
    const data = selector(signature);
    const raw = await provider.call({ to: contract, data });
    if (!raw || raw === "0x") return null;
    return ethers.AbiCoder.defaultAbiCoder().decode(["address"], raw)[0] as string;
  } catch {
    return null;
  }
}

/** Gather the on-chain read snapshot for one contract. */
export async function readChainSnapshot(
  provider: ethers.Provider,
  contract: string,
): Promise<ChainReadSnapshot> {
  const code = await provider.getCode(contract).catch(() => "0x");
  const hasCode = !!code && code !== "0x";

  const [totalMinted, totalSupply, maxSupply, remaining, paused, owner] = await Promise.all([
    readUint(provider, contract, READ_SIGNATURES.totalMinted),
    readUint(provider, contract, READ_SIGNATURES.totalSupply),
    readUint(provider, contract, READ_SIGNATURES.maxSupply),
    readUint(provider, contract, READ_SIGNATURES.remaining),
    readBool(provider, contract, READ_SIGNATURES.paused),
    readAddress(provider, contract, READ_SIGNATURES.owner),
  ]);

  // Mint price: try mintPrice(), then price(), then cost().
  let mintPriceWei: bigint | null = await readUintBig(provider, contract, READ_SIGNATURES.mintPrice);
  if (mintPriceWei === null) mintPriceWei = await readUintBig(provider, contract, READ_SIGNATURES.price);
  if (mintPriceWei === null) mintPriceWei = await readUintBig(provider, contract, READ_SIGNATURES.cost);

  // EIP-1967 implementation slot.
  let implementationSlot: string | null = null;
  try {
    const slot = await provider.getStorage(contract, EIP1967_IMPLEMENTATION_SLOT);
    if (slot && slot !== ethers.ZeroHash) {
      const impl = "0x" + slot.slice(-40);
      if (impl.toLowerCase() !== ZERO_ADDRESS) implementationSlot = ethers.getAddress(impl);
    }
  } catch {
    implementationSlot = null;
  }

  return { hasCode, totalMinted, totalSupply, maxSupply, remaining, mintPriceWei, paused, owner, implementationSlot };
}

/**
 * Vet one contract end-to-end through an adapter.
 * Read-only: only eth_call / getCode / getStorage / HTTP GET. Never sends
 * a transaction.
 */
export async function vetContractWithAdapter(
  adapter: ChainAdapter,
  contract: string,
  deps: EngineDeps,
  walletAddress?: string,
): Promise<VettingVerdict> {
  const address = ethers.getAddress(contract);
  const provider = deps.buildProvider(adapter);

  const sourcify = await deps.fetchSourcify(adapter.sourcifyChainId, address);
  // If the main contract is a proxy, vet the implementation's source too.
  if (!sourcify.isProxy) {
    const snapProbe = await provider.getStorage(address, EIP1967_IMPLEMENTATION_SLOT).catch(() => ethers.ZeroHash);
    if (snapProbe && snapProbe !== ethers.ZeroHash) {
      sourcify.isProxy = true;
      sourcify.implementation = ethers.getAddress("0x" + snapProbe.slice(-40));
    }
  }

  const chain = await readChainSnapshot(provider, address);

  let tokenSecurity: TokenSecurity | null = null;
  if (adapter.getTokenSecurity) {
    tokenSecurity = await adapter.getTokenSecurity(address).catch(() => null);
  }

  const simulation = await simulateMintAt(provider, address, sourcify.abi, walletAddress);

  const input: VettingInput = { contract: address, walletAddress, sourcify, chain, tokenSecurity, simulation };
  return buildVerdict(input, adapter.key, adapter.chainId);
}
