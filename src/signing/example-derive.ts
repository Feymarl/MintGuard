/**
 * MintGuard — contoh derive alamat EVM dari akun NEAR (OFFLINE).
 *
 * Menurunkan alamat BSC/EVM yang dikendalikan oleh sebuah akun NEAR lewat
 * NEAR Chain Signatures — murni komputasi, TANPA private key / seed phrase,
 * TANPA koneksi network. Rumus ini sudah diverifikasi cocok 100% dengan
 * view call `derived_public_key` di kontrak MPC (testnet & mainnet),
 * lihat docs/chain-signatures-research.md §4.
 *
 * Rumus (persis seperti di chainsig.js@1.1.16):
 *   epsilon    = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:{akun},{path}")
 *   childPoint = rootPoint + epsilon * G        (secp256k1)
 *   alamat EVM = 20 byte terakhir dari keccak256(x || y), checksum EIP-55
 *
 * Catatan penting:
 * - Ini BUKAN BIP32/BIP44: tidak ada mnemonic, tidak ada jalur m/44'/...,
 *   path-nya string bebas (mis. "ethereum-1").
 * - Kunci publik NEAR secp256k1 disimpan sebagai 64 byte x||y (tanpa prefix
 *   0x04). Jangan pakai format 33-byte compressed di sini.
 * - Root key di bawah adalah KONSTANTA PUBLIK (bukan secret), diverifikasi
 *   live via RPC 2026-11-09. Kalau self-check di bawah gagal, root key MPC
 *   kemungkinan sudah dirotasi — ambil ulang lewat view call `public_key`
 *   di kontrak MPC (lihat docs/chain-signatures-research.md §2).
 *
 * Cara pakai:
 *   npx tsx src/signing/example-derive.ts
 *   npx tsx src/signing/example-derive.ts <accountId> [path] [--network testnet|mainnet]
 *
 * Contoh:
 *   npx tsx src/signing/example-derive.ts example.testnet ethereum-1
 *   npx tsx src/signing/example-derive.ts example.near ethereum-1 --network mainnet
 */

import elliptic from "elliptic";
import { sha3_256 } from "js-sha3";
import bs58 from "bs58";
import BN from "bn.js";
import { ethers } from "ethers";

const { ec: EC } = elliptic;
const ec = new EC("secp256k1");

// --- Root public key MPC (PUBLIK, bukan secret) — verifikasi live 2026-11-09 ---
// Testnet:  v1.signer-prod.testnet, view call public_key({domain_id: 0})
const TESTNET_ROOT =
  "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3";
// Mainnet:  v1.signer, view call public_key({domain_id: 0})
const MAINNET_ROOT =
  "secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya";

// --- Vektor uji (hasil on-chain `derived_public_key`, 2026-11-09) ---
const KNOWN_VECTORS: Record<string, { evmAddress: string; derivedPubkey: string }> = {
  "testnet|example.testnet|ethereum-1": {
    evmAddress: "0xD8ebbAA4f6558cc6b322987194Fd663a976272bD",
    derivedPubkey:
      "secp256k1:mtY14KMe3TZggrVhPwjM1Z68WKTXDMYNwNjyMTGzioKV3qJhFZ4LZ41KCe5RUNCjC3EGjS5wpZdzGJ5JZ1Dhab5",
  },
  "mainnet|example.near|ethereum-1": {
    evmAddress: "0xEF4Ea05e5c11057DeCC8E1bd6F5369f2acD91fA5",
    derivedPubkey:
      "secp256k1:5zL9u9afiFPPrPmnH7rEz2t3szev5eZ7wXCwzYq37GYyCbJq3YNU31N4LTULioaw3chJx674XUncmYKiSCd3AxxT",
  },
};

/**
 * Turunkan kunci publik secp256k1 (format NEAR: "secp256k1:<base58 64-byte x||y>")
 * untuk (akun NEAR, path) dari root key MPC.
 */
export function deriveChildPublicKey(
  rootPublicKey: string,
  predecessor: string,
  path: string,
): string {
  // Kunci NEAR secp256k1 = 64 byte x||y; jadikan uncompressed 65 byte ("04" + x + y).
  const rootBytes = bs58.decode(rootPublicKey.split(":")[1]);
  if (rootBytes.length !== 64) {
    throw new Error(`Root key harus 64 byte (x||y), dapat ${rootBytes.length} byte.`);
  }
  const parent = ec.keyFromPublic("04" + Buffer.from(rootBytes).toString("hex"), "hex");

  const epsilon = new BN(
    sha3_256(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`),
    16,
  );
  const child = parent.getPublic().add(ec.g.mul(epsilon));

  const x = child.getX().toString("hex").padStart(64, "0");
  const y = child.getY().toString("hex").padStart(64, "0");
  return "secp256k1:" + bs58.encode(Buffer.from(x + y, "hex"));
}

/** Alamat EVM (checksum EIP-55) dari kunci publik turunan format NEAR. */
export function derivedPublicKeyToEvmAddress(derivedPublicKey: string): string {
  const xy = bs58.decode(derivedPublicKey.split(":")[1]); // 64 byte x||y
  return ethers.computeAddress("0x" + Buffer.from(xy).toString("hex"));
}

/** Jalan pintas: akun + path -> alamat EVM, dengan root key network yang dipilih. */
export function deriveEvmAddress(
  predecessor: string,
  path: string,
  network: "testnet" | "mainnet" = "testnet",
): { derivedPublicKey: string; evmAddress: string } {
  const root = network === "mainnet" ? MAINNET_ROOT : TESTNET_ROOT;
  const derivedPublicKey = deriveChildPublicKey(root, predecessor, path);
  return { derivedPublicKey, evmAddress: derivedPublicKeyToEvmAddress(derivedPublicKey) };
}

// --- CLI ---
function parseArgs(argv: string[]): {
  accountId: string;
  path: string;
  network: "testnet" | "mainnet";
} {
  const positional: string[] = [];
  let network: "testnet" | "mainnet" = "testnet";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--network" && argv[i + 1]) {
      const value = argv[++i];
      if (value !== "testnet" && value !== "mainnet") {
        throw new Error(`--network harus "testnet" atau "mainnet", dapat "${value}".`);
      }
      network = value;
    } else if (argv[i].startsWith("--network=")) {
      const value = argv[i].slice("--network=".length);
      if (value !== "testnet" && value !== "mainnet") {
        throw new Error(`--network harus "testnet" atau "mainnet", dapat "${value}".`);
      }
      network = value;
    } else {
      positional.push(argv[i]);
    }
  }
  return {
    accountId: positional[0] ?? "example.testnet",
    path: positional[1] ?? "ethereum-1",
    network,
  };
}

function main(): void {
  const { accountId, path, network } = parseArgs(process.argv.slice(2));
  const root = network === "mainnet" ? MAINNET_ROOT : TESTNET_ROOT;
  const { derivedPublicKey, evmAddress } = deriveEvmAddress(accountId, path, network);

  console.log(`NEAR account : ${accountId}`);
  console.log(`Network      : ${network} (MPC: ${network === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet"})`);
  console.log(`Path         : ${path}`);
  console.log(`MPC root key : ${root}`);
  console.log(`Derived key  : ${derivedPublicKey}`);
  console.log(`EVM address  : ${evmAddress}`);
  console.log(`(offline — tanpa key, tanpa network)`);

  // Self-check terhadap vektor yang terverifikasi on-chain.
  const vector = KNOWN_VECTORS[`${network}|${accountId}|${path}`];
  if (vector) {
    const keyOk = derivedPublicKey === vector.derivedPubkey;
    const addrOk = evmAddress.toLowerCase() === vector.evmAddress.toLowerCase();
    console.log(
      `Self-check   : derived key ${keyOk ? "OK" : "MISMATCH"}, EVM address ${addrOk ? "OK" : "MISMATCH"}`,
    );
    if (!keyOk || !addrOk) {
      console.error(
        "PERINGATAN: hasil tidak cocok dengan nilai on-chain yang tercatat. " +
          "Kemungkinan root key MPC sudah dirotasi — ambil ulang via view call `public_key` " +
          "di kontrak MPC (lihat docs/chain-signatures-research.md §2).",
      );
      process.exit(1);
    }
  }
}

main();
