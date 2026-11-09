// MintGuard — Live full-mode wiring (demo.ts mode=full, live).
//
// This is the MVP assembly: demo's full-live path runs through the
// chainsig EVM adapter in src/signing/broadcast.ts:
//
//   prepare (viem: real nonce + gas from RPC) -> MPC sign -> finalize
//   -> broadcast -> receipt -> ownerOf
//
// Why a separate module instead of reusing demo.ts's generic sign path?
// The generic path signs the hash of a locally-built legacy tx with
// placeholder nonce 0 and 1 gwei gas — a signature over a tx that can
// never broadcast. A live mint MUST be prepared against chain state
// first (the adapter does that), then signed, finalized, broadcast.
//
// GUARDS (enforced here, at broadcast time — none loosened):
//   1. TESTNET ONLY: chainId must be 97 (assertBscTestnetChainId).
//      Mainnet 56 is refused before any RPC write.
//   2. tBNB REQUIRED: balance 0 fails FAST with faucet instructions —
//      before any MPC sign is attempted (signing costs ~15 s of MPC
//      time and a NEAR call; there is nothing to sign for without gas).
//      Balance below the estimated gas also fails fast.
//   3. GAS CEILING: the policy gate is RE-RUN with the REAL gas estimate
//      from the prepared tx (DEFAULT_MAX_GAS_WEI = 0.001 tBNB, hard cap).
//      The first policy check in demo.ts runs without an estimate
//      ("checked at broadcast time") — this is that check.
//   4. SIGNATURE RECOVERY: the MPC signature must recover to the
//      derived address, or the flow aborts before broadcast.
//   5. RECEIPT + OWNERSHIP: receipt status must be "success" and
//      ownerOf(tokenId) must be the derived address, or the run fails
//      (with the tx hash in the error so it can be checked on explorer).
//
// No key material is read here. The factory (createLiveFullDeps) loads
// src/signing/mpc.ts lazily — same seam pattern as demo.ts — and the
// NEAR credentials stay inside mpc.ts (read from .env.local only).
// Nothing in this module deploys, mints, or broadcasts on its own:
// runLiveFullMint only runs when demo.ts mode=full (live) calls it.

import { ethers } from "ethers";
import type { RSVSignature } from "chainsig.js";
import type { VettingVerdict } from "../vetting/core/types.js";
import { checkPolicy, DEFAULT_MAX_GAS_WEI } from "./policy.js";
import {
  assertBscTestnetChainId,
  broadcastSignedTx,
  createBscTestnetClient,
  createEvmAdapter,
  explorerTxUrl,
  finalizeTx,
  prepareTxForSigning,
  readOwnerOf,
  readTotalSupply,
  waitForReceipt,
  type EvmTxRequest,
  type EvmUnsignedTx,
  type PreparedTx,
} from "../signing/broadcast.js";

/** Where to get free tBNB when the derived address is empty. */
export const TBNB_FAUCET_HINT =
  "tBNB balance is 0 — the derived address has no gas, so nothing can be broadcast. " +
  "Get free tBNB (0.3 tBNB/day, no mainnet balance required) by messaging the official " +
  "Telegram faucet bot @bnbchain_official_bot from your phone: " +
  "`I would like to get tBNB to my wallet <derived-address>`. " +
  "See https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/ — then re-run demo mode=full.";

/**
 * Calldata for the mint function that vetting actually simulated.
 * Loose builder: unknown shapes return empty calldata ("0x") — the
 * tx stays signable for dry-run / sign-mode demos, but the mint would
 * not execute. NEVER use the loose result for a live broadcast.
 */
export function buildMintCalldata(
  simulatedFunction: string | null,
  wallet?: string,
): string {
  if (simulatedFunction === "mint()") {
    return new ethers.Interface(["function mint()"]).encodeFunctionData("mint");
  }
  if (simulatedFunction === "mint(uint256)") {
    return new ethers.Interface(["function mint(uint256 quantity)"]).encodeFunctionData(
      "mint",
      [1],
    );
  }
  if (simulatedFunction === "mint(address)" && wallet) {
    return new ethers.Interface(["function mint(address to)"]).encodeFunctionData("mint", [
      wallet,
    ]);
  }
  return "0x";
}

/**
 * Strict calldata builder for the LIVE path. An unknown mint shape is
 * refused outright: sending empty calldata would burn gas and mint
 * nothing, so the run fails here with a clear message instead.
 */
export function buildLiveMintCalldata(
  simulatedFunction: string | null,
  wallet: string,
): string {
  const calldata = buildMintCalldata(simulatedFunction, wallet);
  if (calldata === "0x") {
    throw new Error(
      `Live mint refused: simulated function ${JSON.stringify(simulatedFunction)} has no known ` +
        `calldata builder (supported: "mint()", "mint(uint256)", "mint(address)"). ` +
        `Refusing to send an empty-calldata tx — it would burn gas and mint nothing.`,
    );
  }
  return calldata;
}

/** Fields of a prepared tx that determine its gas cost. */
export interface PreparedGasFields {
  gasLimit?: bigint | number | null;
  /**
   * viem-style gas limit. The chainsig EVM adapter prepares viem
   * transactions, which carry `gas` (not `gasLimit`): a prepared tx
   * from the adapter has { gas, maxFeePerGas, maxPriorityFeePerGas }.
   * Reading only `gasLimit` made the estimator return null for every
   * real prepared tx and the live flow refused to broadcast blind.
   */
  gas?: bigint | number | null;
  gasPrice?: bigint | number | null;
  maxFeePerGas?: bigint | number | null;
}

/**
 * Estimated total gas cost (wei) of a prepared tx: gasLimit * fee.
 * EIP-1559 (type 2, what the chainsig adapter prepares) uses
 * maxFeePerGas; legacy txs use gasPrice. The limit is read from
 * `gasLimit` (ethers style) or `gas` (viem style, what the adapter
 * actually prepares). Returns null when the cost cannot be determined —
 * the caller must refuse to broadcast blind.
 */
export function estimateGasCostWei(tx: PreparedGasFields): bigint | null {
  const limit = tx.gasLimit ?? tx.gas;
  if (limit === undefined || limit === null) return null;
  const fee = tx.maxFeePerGas ?? tx.gasPrice;
  if (fee === undefined || fee === null) return null;
  return BigInt(limit) * BigInt(fee);
}

/**
 * Fail fast when the derived address cannot pay the estimated gas.
 * Balance 0 gets the faucet instructions; a short balance gets the
 * exact numbers so the top-up amount is obvious.
 */
export function assertBalanceCoversGas(balanceWei: bigint, estimatedGasWei: bigint): void {
  if (balanceWei === 0n) {
    throw new Error(TBNB_FAUCET_HINT);
  }
  if (balanceWei < estimatedGasWei) {
    throw new Error(
      `tBNB balance too low for this mint: balance ${balanceWei} wei < estimated gas ` +
        `${estimatedGasWei} wei (short by ${estimatedGasWei - balanceWei} wei). ` +
        `Top up the derived address with free tBNB first: ${TBNB_FAUCET_HINT}`,
    );
  }
}

/**
 * Offline recovery check, mirroring src/signing/mpc.ts
 * verifySignatureRecovery (same normalization, same semantics):
 * the MPC signature over a 32-byte payload hash must recover to the
 * derived address. `r`/`s` may be hex with or without the 0x prefix.
 */
export function verifySignatureRecovery(
  payloadHash: Uint8Array | string,
  rsv: RSVSignature,
  expectedAddress: string,
): { recoveredAddress: string; matches: boolean } {
  const hashHex =
    typeof payloadHash === "string"
      ? payloadHash
      : "0x" + Buffer.from(payloadHash).toString("hex");
  const sig = {
    r: "0x" + rsv.r.replace(/^0x/, "").padStart(64, "0"),
    s: "0x" + rsv.s.replace(/^0x/, "").padStart(64, "0"),
    v: rsv.v,
  };
  const recoveredAddress = ethers.recoverAddress(hashHex, sig);
  return {
    recoveredAddress,
    matches: recoveredAddress.toLowerCase() === expectedAddress.toLowerCase(),
  };
}

/**
 * Everything the live flow needs from the chain / MPC network.
 * All members are injectable so runLiveFullMint is unit-testable
 * offline with fakes — no network, no key, no broadcast in tests.
 * The real implementation comes from createLiveFullDeps().
 */
export interface LiveFullDeps {
  getChainId(): Promise<number>;
  getBalance(address: string): Promise<bigint>;
  prepare(request: EvmTxRequest): Promise<PreparedTx>;
  /** MPC sign over one 32-byte payload hash. */
  sign(payload: Uint8Array): Promise<RSVSignature>;
  finalize(transaction: EvmUnsignedTx, signatures: RSVSignature[]): string;
  broadcast(signedTx: string): Promise<{ hash: string }>;
  waitReceipt(hash: `0x${string}`): Promise<{
    status: string;
    blockNumber: bigint;
    gasUsed: bigint;
  }>;
  readTotalSupply(contract: `0x${string}`): Promise<bigint>;
  readOwnerOf(contract: `0x${string}`, tokenId: bigint): Promise<string>;
}

export interface LiveFullInput {
  /** Vetting verdict that already passed demo.ts's policy gate. */
  verdict: VettingVerdict;
  /** EVM address derived from the NEAR account (the minter). */
  derivedAddress: string;
  /** Policy options carried over from demo.ts's first gate check. */
  policy: {
    mintValueWei?: bigint | string;
    maxGasWei?: bigint | string;
    humanApprovedExact?: boolean;
  };
}

export interface LiveFullResult {
  txHash: string;
  tokenId: bigint;
  owner: string;
  receipt: { status: string; blockNumber: bigint; gasUsed: bigint };
  estimatedGasWei: bigint;
  explorerTxUrl: string;
}

/**
 * The live full-mint flow. Throws with a clear, actionable message on
 * every failure — never a mysterious crash, and never a partial
 * broadcast: each guard runs BEFORE the step it protects.
 */
export async function runLiveFullMint(
  deps: LiveFullDeps,
  input: LiveFullInput,
): Promise<LiveFullResult> {
  const { verdict, derivedAddress } = input;
  const contract = verdict.contract as `0x${string}`;
  const maxGasWei = input.policy.maxGasWei ?? DEFAULT_MAX_GAS_WEI;

  // 1. Chain guard: testnet only, before any RPC write.
  const chainId = await deps.getChainId();
  assertBscTestnetChainId(chainId);
  console.log(`[live-full] BSC chainId ${chainId} (testnet OK)`);

  // 2. Strict calldata: the simulated mint function must be buildable.
  const calldata = buildLiveMintCalldata(verdict.simulatedFunction, derivedAddress);
  console.log(`[live-full] mint calldata: ${calldata} (to ${contract}, value 0)`);

  // 3. Balance guard FIRST: no tBNB => fail fast, no MPC sign wasted.
  const balance = await deps.getBalance(derivedAddress);
  console.log(`[live-full] tBNB balance: ${ethers.formatEther(balance)} tBNB`);
  if (balance === 0n) {
    throw new Error(TBNB_FAUCET_HINT);
  }

  // 4. Prepare against chain state (real nonce + gas from RPC).
  const prepared = await deps.prepare({
    from: derivedAddress as `0x${string}`,
    to: contract,
    data: calldata as `0x${string}`,
    value: 0n,
  } as EvmTxRequest);
  const payload = prepared.hashesToSign[0];
  if (!payload) {
    throw new Error("Live mint refused: prepared tx has no signing hash.");
  }
  const payloadBytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (payloadBytes.length !== 32) {
    throw new Error(
      `Live mint refused: signing hash must be 32 bytes, got ${payloadBytes.length}.`,
    );
  }

  // 5. Gas ceiling, re-checked with the REAL estimate (this is the
  //    "checked at broadcast time" half of the policy gate).
  const estimatedGasWei = estimateGasCostWei(prepared.transaction);
  if (estimatedGasWei === null) {
    throw new Error(
      "Live mint refused: could not determine the gas cost of the prepared tx " +
        "(no gasLimit / fee) — refusing to broadcast blind.",
    );
  }
  console.log(`[live-full] estimated gas cost: ${estimatedGasWei} wei`);
  const policy = checkPolicy(verdict, {
    chainId,
    mintValueWei: input.policy.mintValueWei,
    estimatedGasWei,
    maxGasWei,
    humanApprovedExact: input.policy.humanApprovedExact,
  });
  if (!policy.allowed) {
    throw new Error(`Live mint refused by policy gate (broadcast-time re-check): ${policy.reason}`);
  }
  assertBalanceCoversGas(balance, estimatedGasWei);

  // 6. MPC sign + recovery check (abort before broadcast on mismatch).
  const t0 = Date.now();
  const signature = await deps.sign(payloadBytes);
  console.log(`[live-full] MPC sign latency: ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  const { recoveredAddress, matches } = verifySignatureRecovery(
    payloadBytes,
    signature,
    derivedAddress,
  );
  console.log(`[live-full] recovery: ${recoveredAddress} (${matches ? "MATCH" : "MISMATCH"})`);
  if (!matches) {
    throw new Error(
      `Live mint refused: MPC signature recovers to ${recoveredAddress}, not the derived ` +
        `address ${derivedAddress} — aborting before broadcast.`,
    );
  }

  // 7. Finalize + broadcast.
  const signedTx = deps.finalize(prepared.transaction, [signature]);
  const { hash } = await deps.broadcast(signedTx);
  const txUrl = explorerTxUrl(hash);
  console.log(`[live-full] broadcast: ${hash} (${txUrl})`);

  // 8. Receipt must be success.
  const receipt = await deps.waitReceipt(hash as `0x${string}`);
  console.log(
    `[live-full] receipt: status=${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`,
  );
  if (receipt.status !== "success") {
    throw new Error(
      `Live mint tx reverted on-chain: ${hash} (${txUrl}). Check the explorer for the revert reason.`,
    );
  }

  // 9. Ownership proof: tokenId = post-mint totalSupply (sequential
  //    minting from 1, same convention as src/signing/cli-mint.ts),
  //    and ownerOf(tokenId) must be the derived address.
  const tokenId = await deps.readTotalSupply(contract);
  const owner = await deps.readOwnerOf(contract, tokenId);
  console.log(`[live-full] ownerOf(${tokenId}): ${owner}`);
  if (owner.toLowerCase() !== derivedAddress.toLowerCase()) {
    throw new Error(
      `Live mint verification failed: ownerOf(${tokenId}) is ${owner}, not the derived address ` +
        `${derivedAddress}. The tx succeeded (${txUrl}) but ownership could not be confirmed — ` +
        `check the contract on the explorer before retrying.`,
    );
  }

  return {
    txHash: hash,
    tokenId,
    owner,
    receipt,
    estimatedGasWei,
    explorerTxUrl: txUrl,
  };
}

/**
 * Build the real LiveFullDeps: viem client + chainsig EVM adapter +
 * MPC contract + NEAR signer account. mpc.ts is loaded lazily (same
 * seam pattern as demo.ts loadLiveSigner) so a missing module is a
 * clear error, not a crash. Credentials are read by mpc.ts only
 * (getNearCredentials throws a clear error when .env.local has no key)
 * and are never printed or stored here.
 */
export async function createLiveFullDeps(
  accountId: string,
  path: string,
): Promise<LiveFullDeps> {
  let mpc: Record<string, unknown>;
  try {
    // Computed specifier: tsc must NOT resolve this statically.
    const specifier = "../signing/mpc.js";
    mpc = (await import(specifier)) as Record<string, unknown>;
  } catch (err: unknown) {
    throw new Error(
      `Live MPC signer not available: src/signing/mpc.ts could not be loaded (${err instanceof Error ? err.message : String(err)}). ` +
        `The signing module is still being built — run with --dry-run to exercise the flow.`,
    );
  }
  const required = [
    "createMpcContract",
    "deriveAddressViaMpc",
    "signPayload",
    "getNearCredentials",
    "createNearAccount",
    "createSignerAccount",
  ] as const;
  for (const name of required) {
    if (typeof mpc[name] !== "function") {
      throw new Error(
        `Live MPC signer incomplete: src/signing/mpc.ts does not export ${name}(). ` +
          `Run with --dry-run, or wait for the signing worker to land it.`,
      );
    }
  }
  const createMpcContract = mpc.createMpcContract as (
    networkId: string,
  ) => InstanceType<typeof import("chainsig.js").contracts.ChainSignatureContract>;
  const signPayload = mpc.signPayload as (
    contract: unknown,
    signerAccount: unknown,
    payload: Uint8Array,
    path: string,
    keyType: "Ecdsa",
  ) => Promise<{ signatures: RSVSignature[] }>;
  const getNearCredentials = mpc.getNearCredentials as () => {
    accountId: string;
    privateKey: string;
  };
  const createNearAccount = mpc.createNearAccount as (
    accountId: string,
    privateKey: string,
    networkId: string,
  ) => unknown;
  const createSignerAccount = mpc.createSignerAccount as (
    account: unknown,
  ) => unknown;

  // Throws a clear error when .env.local has no key.
  const creds = getNearCredentials();
  if (creds.accountId !== accountId) {
    throw new Error(
      `NEAR_ACCOUNT_ID mismatch: demo asked for ${accountId} but .env.local has ${creds.accountId}.`,
    );
  }

  const publicClient = createBscTestnetClient();
  const contract = createMpcContract("testnet");
  const account = createNearAccount(creds.accountId, creds.privateKey, "testnet");
  const signerAccount = createSignerAccount(account);
  const evm = createEvmAdapter(publicClient, contract);

  return {
    getChainId: () => publicClient.getChainId(),
    getBalance: (address: string) =>
      publicClient.getBalance({ address: address as `0x${string}` }),
    prepare: (request: EvmTxRequest) => prepareTxForSigning(evm, request),
    sign: async (payload: Uint8Array) => {
      const { signatures } = await signPayload(
        contract,
        signerAccount,
        payload,
        path,
        "Ecdsa",
      );
      const sig = signatures[0];
      if (!sig) throw new Error("MPC returned no signature.");
      return sig;
    },
    finalize: (transaction: EvmUnsignedTx, signatures: RSVSignature[]) =>
      finalizeTx(evm, transaction, signatures),
    broadcast: (signedTx: string) => broadcastSignedTx(evm, signedTx),
    waitReceipt: (hash: `0x${string}`) => waitForReceipt(publicClient, hash),
    readTotalSupply: (contractAddress: `0x${string}`) =>
      readTotalSupply(publicClient, contractAddress),
    readOwnerOf: (contractAddress: `0x${string}`, tokenId: bigint) =>
      readOwnerOf(publicClient, contractAddress, tokenId),
  };
}
