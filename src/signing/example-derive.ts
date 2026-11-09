/**
 * MintGuard — contoh derive alamat EVM dari akun NEAR (OFFLINE).
 *
 * Thin CLI di atas src/signing/derive.ts. Murni komputasi, TANPA private
 * key / seed phrase, TANPA koneksi network. Rumus sudah diverifikasi cocok
 * 100% dengan view call `derived_public_key` di kontrak MPC (testnet &
 * mainnet), lihat docs/chain-signatures-research.md §4.
 *
 * Cara pakai:
 *   npx tsx src/signing/example-derive.ts
 *   npx tsx src/signing/example-derive.ts <accountId> [path] [--network testnet|mainnet]
 *
 * Contoh:
 *   npx tsx src/signing/example-derive.ts example.testnet ethereum-1
 *   npx tsx src/signing/example-derive.ts example.near ethereum-1 --network mainnet
 */

import {
  KNOWN_VECTORS,
  MPC_CONTRACTS,
  MPC_ROOT_KEYS,
  deriveEvmAddress,
  type NearNetwork,
} from "./derive.js";

// --- CLI ---
function parseArgs(argv: string[]): {
  accountId: string;
  path: string;
  network: NearNetwork;
} {
  const positional: string[] = [];
  let network: NearNetwork = "testnet";
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
  const root = MPC_ROOT_KEYS[network];
  const { derivedPublicKey, evmAddress } = deriveEvmAddress(accountId, path, network);

  console.log(`NEAR account : ${accountId}`);
  console.log(`Network      : ${network} (MPC: ${MPC_CONTRACTS[network]})`);
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
