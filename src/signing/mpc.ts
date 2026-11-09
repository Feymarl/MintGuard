/**
 * MintGuard — MPC signing via NEAR Chain Signatures (chainsig.js@1.1.16).
 *
 * API bundle yang dipakai di sini dibaca langsung dari bundle rilis
 * `chainsig.js@1.1.16` (bukan dari README GitHub yang sudah basi) —
 * lihat docs/chain-signatures-research.md §3:
 *
 *   contract.sign({
 *     payloads: [hash32bytes],   // array, bukan `payload` tunggal
 *     path: "ethereum-1",
 *     keyType: "Ecdsa",          // "Ecdsa" | "Eddsa", bukan `key_version`
 *     signerAccount,             // { accountId, signAndSendTransactions }
 *   });
 *
 * Di balik layar `sign` mengirim function call ke kontrak MPC dengan
 * method `sign`, args
 * `{request: {payload_v2: {Ecdsa: <32-byte hash>}, path, domain_id: 0}}`,
 * prepaid gas 300 TGas, attached deposit 1 yoctoNEAR.
 *
 * Bagian yang tadinya belum pasti (§8 blocker #1): bentuk `signerAccount`
 * untuk agen CLI. Ternyata `@near-js/accounts@2.5.1` sudah punya
 * `Account.signAndSendTransactions({transactions: [{receiverId, actions}]})`
 * — bentuk yang persis dipakai `chainsig.js` (ia memanggil
 * `signerAccount.signAndSendTransactions({transactions})` dengan tiap
 * transaksi `{signerId, receiverId, actions}`). Jadi adapter di sini
 * tinggal membungkus `Account` itu; tidak perlu `@hot-labs/near-connect`
 * (wallet browser) untuk agen CLI.
 *
 * KEAMANAN KEY:
 * - Private key akun NEAR testnet HANYA dibaca dari environment
 *   (`.env.local`, gitignored) — tidak pernah ditulis ke repo, chat, atau
 *   log. Fungsi di file ini tidak pernah mencetak key.
 * - Key yang dipakai sebaiknya function-call key yang di-scope ke
 *   `v1.signer-prod.testnet` metode `sign` saja (lihat riset §9); untuk
 *   demo testnet ini dipakai full-access key akun testnet — catat di
 *   README bahwa itu batasan demo, bukan pola produksi.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Account } from "@near-js/accounts";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { JsonRpcProvider, FailoverRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import type { FinalExecutionOutcome } from "@near-js/types";
import { ethers } from "ethers";
import {
  contracts,
  type RSVSignature,
} from "chainsig.js";
import {
  DEFAULT_PATH,
  MPC_CONTRACTS,
  deriveEvmAddress,
  type NearNetwork,
} from "./derive.js";

export const TESTNET_NEAR_RPC = "https://rpc.testnet.near.org";
export const MAINNET_NEAR_RPC = "https://rpc.mainnet.near.org";

/**
 * RPC testnet cadangan. Dipakai lewat FailoverRpcProvider (retry + pindah
 * provider) karena egress VM ini kadang menutup socket TLS di tengah
 * request (UND_ERR_SOCKET "other side closed") — satu provider saja
 * membuat `sign` gagal intermiten (ditemukan saat validasi Day-1).
 */
export const TESTNET_NEAR_RPC_URLS = [
  TESTNET_NEAR_RPC,
  "https://test.rpc.fastnear.com",
  "https://near-testnet.drpc.org",
  "https://testnet-rpc.intea.rs",
];

/** Bentuk `signerAccount` yang diminta `ChainSignatureContract.sign`. */
export interface ChainSigSignerAccount {
  accountId: string;
  signAndSendTransactions: (args: {
    transactions: { receiverId: string; actions: unknown[] }[];
  }) => Promise<FinalExecutionOutcome[]>;
}

/** Muat `.env.local` (repo root) ke `process.env` — parser minimal, tanpa dep baru. */
export function loadEnvLocal(): void {
  const candidates = [
    join(process.cwd(), ".env.local"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env.local"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

/** Kredensial akun NEAR dari environment. Key tidak pernah di-log. */
export function getNearCredentials(): { accountId: string; privateKey: string } {
  loadEnvLocal();
  const accountId = process.env.NEAR_ACCOUNT_ID;
  const privateKey = process.env.NEAR_PRIVATE_KEY;
  if (!accountId || !privateKey) {
    throw new Error(
      "NEAR_ACCOUNT_ID / NEAR_PRIVATE_KEY belum diset. Isi .env.local (gitignored) " +
        "atau export keduanya di environment.",
    );
  }
  return { accountId, privateKey };
}

/**
 * Bangun `Account` @near-js dari keypair (ed25519) akun testnet.
 * `networkId` hanya "testnet" di modul ini — mainnet ditolak (demo testnet-only).
 */
export function createNearAccount(
  accountId: string,
  privateKey: string,
  networkId: NearNetwork = "testnet",
  rpcUrl?: string,
): Account {
  if (networkId !== "testnet") {
    throw new Error("Modul ini testnet-only: networkId harus \"testnet\".");
  }
  const keyPair = KeyPair.fromString(privateKey as KeyPairString);
  // FailoverRpcProvider: tiap panggilan RPC di-retry dengan backoff dan
  // pindah provider bila satu RPC menutup koneksi (lihat TESTNET_NEAR_RPC_URLS).
  const provider = rpcUrl
    ? new JsonRpcProvider({ url: rpcUrl })
    : new FailoverRpcProvider(TESTNET_NEAR_RPC_URLS.map((url) => new JsonRpcProvider({ url })));
  const signer = KeyPairSigner.fromSecretKey(privateKey as KeyPairString);
  void keyPair; // keypair dipakai lewat KeyPairSigner; simpan referensi agar jelas
  return new Account(accountId, provider, signer);
}

/**
 * Adapter `signerAccount` untuk chainsig.js dari `Account` @near-js.
 * Memetakan tiap transaksi ke bentuk `{receiverId, actions}` yang
 * diterima `Account.signAndSendTransactions` (field `signerId` dari
 * chainsig dibuang — signer sudah implisit dari Account).
 */
export function createSignerAccount(account: Account): ChainSigSignerAccount {
  return {
    accountId: account.accountId,
    signAndSendTransactions: async ({ transactions }) =>
      account.signAndSendTransactions({
        transactions: transactions.map((tx) => ({
          receiverId: tx.receiverId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          actions: tx.actions as any,
        })),
      }),
  };
}

/** Kontrak MPC Chain Signatures (default: v1.signer-prod.testnet). */
export function createMpcContract(
  networkId: NearNetwork = "testnet",
  contractId?: string,
): InstanceType<typeof contracts.ChainSignatureContract> {
  return new contracts.ChainSignatureContract({
    networkId,
    contractId: contractId ?? MPC_CONTRACTS[networkId],
  });
}

export interface SignResult {
  /** Tanda tangan MPC (r, s hex tanpa prefix 0x; v = 27/28). */
  signatures: RSVSignature[];
  /** Latensi end-to-end panggilan `sign` (ms) — ukur saat validasi live. */
  latencyMs: number;
}

/**
 * Minta tanda tangan MPC atas satu payload hash 32-byte.
 * `payload` harus Uint8Array/array 32 byte (mis. keccak256 hash transaksi
 * atau hash pesan). Mengembalikan tanda tangan + latensi terukur.
 */
export async function signPayload(
  contract: InstanceType<typeof contracts.ChainSignatureContract>,
  signerAccount: ChainSigSignerAccount,
  payload: Uint8Array | number[],
  path: string = DEFAULT_PATH,
  keyType: "Ecdsa" | "Eddsa" = "Ecdsa",
): Promise<SignResult> {
  const bytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
  if (bytes.length !== 32) {
    throw new Error(`Payload harus 32 byte, dapat ${bytes.length} byte.`);
  }
  const started = Date.now();
  const signatures = await contract.sign({
    payloads: [bytes],
    path,
    keyType,
    // chainsig mengetik signerAccount secara longgar; adapter kita cocok.
    signerAccount: signerAccount as never,
  });
  return { signatures, latencyMs: Date.now() - started };
}

/**
 * Derive alamat EVM + kunci publik turunan lewat kontrak MPC
 * (`getDerivedPublicKey`). Untuk kontrak yang dikenal, chainsig menghitung
 * ini secara lokal dari root key publik — hasilnya di-cross-check dengan
 * rumus offline kita (`deriveEvmAddress`) agar tidak bergantung buta pada
 * satu implementasi.
 */
export async function deriveAddressViaMpc(
  contract: InstanceType<typeof contracts.ChainSignatureContract>,
  accountId: string,
  path: string = DEFAULT_PATH,
  network: NearNetwork = "testnet",
): Promise<{ address: string; publicKey: string; offlineAddress: string }> {
  const publicKey = await contract.getDerivedPublicKey({ path, predecessor: accountId });
  const { evmAddress: offlineAddress } = deriveEvmAddress(accountId, path, network);
  // getDerivedPublicKey mengembalikan "04..." uncompressed SEC1 (65 byte hex).
  const xy = publicKey.startsWith("04") ? publicKey.slice(2) : publicKey;
  const address = ethers.computeAddress("0x" + xy);
  if (address.toLowerCase() !== offlineAddress.toLowerCase()) {
    throw new Error(
      `Alamat turunan MPC (${address}) tidak cocok dengan rumus offline (${offlineAddress}).`,
    );
  }
  return { address, publicKey, offlineAddress };
}

/**
 * View call `derived_public_key` LANGSUNG ke RPC NEAR (tanpa chainsig) —
 * pembanding on-chain yang independen untuk rumus derivasi offline.
 * Mengembalikan kunci turunan format NEAR ("secp256k1:<base58>").
 */
export async function fetchDerivedPublicKeyOnChain(
  rpcUrl: string,
  contractId: string,
  predecessor: string,
  path: string,
): Promise<string> {
  const args = Buffer.from(
    JSON.stringify({ domain_id: 0, predecessor, path }),
  ).toString("base64");
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mintguard-derived-key",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: contractId,
        method_name: "derived_public_key",
        args_base64: args,
        finality: "final",
      },
    }),
  });
  const json = (await res.json()) as {
    result?: { result?: number[] };
    error?: { message?: string };
  };
  if (json.error || !json.result?.result) {
    throw new Error(
      `View call derived_public_key gagal: ${json.error?.message ?? "tanpa result"}`,
    );
  }
  const decoded = JSON.parse(Buffer.from(json.result.result).toString("utf8")) as string;
  return decoded;
}

/**
 * Verifikasi offline: recovery alamat EVM dari tanda tangan ECDSA atas
 * hash 32-byte. Harus sama dengan alamat turunan bila tanda tangan MPC
 * valid untuk (akun, path) tersebut.
 *
 * `rsv`: {r, s} hex (boleh tanpa prefix 0x), v = 27 atau 28.
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
