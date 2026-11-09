/**
 * MintGuard — finalize + broadcast transaksi BSC testnet yang sudah
 * ditandatangani MPC (chainsig.js EVM adapter + viem).
 *
 * BATAS KERAS: testnet-only. `chainId` selain 97 (BSC testnet / Chapel)
 * DITOLAK di sini — terutama mainnet 56. Tidak ada transaksi mainnet
 * yang boleh lewat modul ini.
 *
 * Alur: prepare (viem: gas + nonce + hash) -> sign MPC (mpc.ts) ->
 * finalize (rangkai r/s/v ke tx) -> broadcast (viem sendRawTransaction)
 * -> receipt -> verifikasi ownerOf.
 */

import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import {
  chainAdapters,
  contracts,
  type RSVSignature,
} from "chainsig.js";

/** Tipe adapter EVM chainsig.js (diturunkan dari class, bukan import tipe langsung). */
export type EvmAdapter = InstanceType<typeof chainAdapters.evm.EVM>;
export type EvmTxRequest = Parameters<EvmAdapter["prepareTransactionForSigning"]>[0];
export type EvmUnsignedTx = Awaited<
  ReturnType<EvmAdapter["prepareTransactionForSigning"]>
>["transaction"];

/** BSC testnet (Chapel) — satu-satunya chain yang diizinkan modul ini. */
export const BSC_TESTNET_CHAIN_ID = 97;
/** BSC mainnet — ditolak eksplisit. */
export const BSC_MAINNET_CHAIN_ID = 56;

export const BSC_TESTNET_RPC_URLS = [
  "https://data-seed-prebsc-1-s1.binance.org:8545",
  "https://bsc-testnet-dataseed.bnbchain.org",
  "https://bsc-testnet-rpc.publicnode.com",
  "https://bnb-testnet.api.onfinality.io/public",
];

export const BSC_TESTNET_EXPLORER = "https://testnet.bscscan.com";

/** Tolak chainId apa pun selain BSC testnet 97 (terutama mainnet 56). */
export function assertBscTestnetChainId(chainId: number): void {
  if (chainId === BSC_MAINNET_CHAIN_ID) {
    throw new Error(
      "DITOLAK: chainId 56 adalah BSC MAINNET. Modul ini testnet-only (97).",
    );
  }
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `DITOLAK: chainId ${chainId} bukan BSC testnet (97). Modul ini testnet-only.`,
    );
  }
}

/**
 * viem PublicClient ke BSC testnet, dengan fallback antar RPC.
 * (Egress VM kadang menutup socket di tengah request — fallback membuat
 * satu RPC yang gagal tidak menggagalkan seluruh alur.)
 */
export function createBscTestnetClient(rpcUrl?: string): PublicClient {
  const transport = rpcUrl
    ? http(rpcUrl)
    : fallback(BSC_TESTNET_RPC_URLS.map((url) => http(url)));
  return createPublicClient({
    chain: bscTestnet, // chainId 97 — dijaga juga oleh assert di bawah
    transport,
  });
}

/** Adapter EVM chainsig.js (prepare/finalize/broadcast). */
export function createEvmAdapter(
  publicClient: PublicClient,
  contract: InstanceType<typeof contracts.ChainSignatureContract>,
): EvmAdapter {
  return new chainAdapters.evm.EVM({ publicClient, contract });
}

export interface PreparedTx {
  transaction: EvmUnsignedTx;
  hashesToSign: (number[] | Uint8Array)[];
}

/**
 * Siapkan transaksi unsigned (gas + nonce + chainId diisi dari RPC) dan
 * kembalikan hash 32-byte yang harus ditandatangani MPC.
 * `from` = alamat turunan MPC; `to` = kontrak target; `data` = calldata.
 */
export async function prepareTxForSigning(
  evm: EvmAdapter,
  request: EvmTxRequest,
): Promise<PreparedTx> {
  const { transaction, hashesToSign } = await evm.prepareTransactionForSigning(request);
  assertBscTestnetChainId(Number(transaction.chainId));
  return { transaction, hashesToSign };
}

/**
 * Rangkai tanda tangan MPC (r, s, v) ke transaksi unsigned -> raw tx
 * ter-serialisasi (0x02... EIP-1559) yang siap broadcast.
 */
export function finalizeTx(
  evm: EvmAdapter,
  transaction: EvmUnsignedTx,
  rsvSignatures: RSVSignature[],
): string {
  return evm.finalizeTransactionSigning({ transaction, rsvSignatures });
}

/** Broadcast raw tx ke BSC testnet; kembalikan hash transaksi. */
export async function broadcastSignedTx(
  evm: EvmAdapter,
  signedTx: string,
): Promise<{ hash: string }> {
  return evm.broadcastTx(signedTx);
}

/** Tunggu receipt (timeout default 120 detik). */
export async function waitForReceipt(
  publicClient: PublicClient,
  hash: `0x${string}`,
  timeoutMs = 120_000,
): Promise<{ status: string; blockNumber: bigint; gasUsed: bigint }> {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: timeoutMs,
  });
  return {
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  };
}

/** Baca ownerOf(tokenId) di kontrak ERC721 (cek kepemilikan pasca-mint). */
export async function readOwnerOf(
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
  tokenId: bigint,
): Promise<string> {
  const owner = await publicClient.readContract({
    address: contractAddress,
    abi: [
      {
        type: "function",
        name: "ownerOf",
        stateMutability: "view",
        inputs: [{ name: "tokenId", type: "uint256" }],
        outputs: [{ name: "", type: "address" }],
      },
    ],
    functionName: "ownerOf",
    args: [tokenId],
  });
  return owner as string;
}

/** Baca totalSupply() (dipakai untuk menentukan tokenId hasil mint). */
export async function readTotalSupply(
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
): Promise<bigint> {
  return (await publicClient.readContract({
    address: contractAddress,
    abi: [
      {
        type: "function",
        name: "totalSupply",
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "uint256" }],
      },
    ],
    functionName: "totalSupply",
    args: [],
  })) as bigint;
}

export function explorerTxUrl(hash: string): string {
  return `${BSC_TESTNET_EXPLORER}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${BSC_TESTNET_EXPLORER}/address/${address}`;
}
