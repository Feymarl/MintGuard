/**
 * MintGuard — CLI validasi Layer C: derive + MPC sign + recovery offline.
 *
 *   npx tsx src/signing/cli-sign.ts [--message <teks>] [--path ethereum-1]
 *
 * Langkah:
 *   1. Derive alamat EVM dari akun NEAR (offline) + cross-check dengan
 *      view call `derived_public_key` on-chain (RPC NEAR, read-only).
 *   2. Derive lagi lewat kontrak MPC (chainsig `getDerivedPublicKey`).
 *   3. MPC `sign` atas keccak256 hash pesan (default: "MintGuard day-1
 *      validation") — latensi diukur.
 *   4. Verifikasi offline: recovery alamat dari (r, s, v) harus sama
 *      dengan alamat turunan.
 *
 * Key HANYA dari .env.local (gitignored). Tidak ada key yang dicetak.
 * Keluar 0 bila semua cocok, 1 bila ada yang gagal.
 */
import { ethers } from "ethers";
import {
  DEFAULT_PATH,
  MPC_CONTRACTS,
  deriveEvmAddress,
  derivedPublicKeyToEvmAddress,
} from "./derive.js";
import {
  TESTNET_NEAR_RPC,
  createMpcContract,
  createNearAccount,
  createSignerAccount,
  deriveAddressViaMpc,
  fetchDerivedPublicKeyOnChain,
  getNearCredentials,
  signPayload,
  verifySignatureRecovery,
} from "./mpc.js";

function parseArgs(argv: string[]): { message: string; path: string } {
  let message = "MintGuard day-1 validation";
  let path = DEFAULT_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--message" && argv[i + 1]) message = argv[++i];
    else if (argv[i] === "--path" && argv[i + 1]) path = argv[++i];
  }
  return { message, path };
}

async function main(): Promise<void> {
  const { message, path } = parseArgs(process.argv.slice(2));
  const { accountId, privateKey } = getNearCredentials();
  console.log(`NEAR account : ${accountId}`);
  console.log(`MPC contract : ${MPC_CONTRACTS.testnet}`);
  console.log(`Path         : ${path}`);

  // 1. Derive offline + cross-check on-chain (view call read-only).
  const offline = deriveEvmAddress(accountId, path, "testnet");
  console.log(`Derived key  : ${offline.derivedPublicKey}`);
  console.log(`EVM address  : ${offline.evmAddress} (offline)`);
  const onChainKey = await fetchDerivedPublicKeyOnChain(
    TESTNET_NEAR_RPC,
    MPC_CONTRACTS.testnet,
    accountId,
    path,
  );
  const onChainAddress = derivedPublicKeyToEvmAddress(onChainKey);
  console.log(`On-chain key : ${onChainKey}`);
  console.log(`On-chain addr: ${onChainAddress}`);
  if (onChainAddress.toLowerCase() !== offline.evmAddress.toLowerCase()) {
    throw new Error("Alamat on-chain TIDAK cocok dengan rumus offline.");
  }
  console.log("Cross-check derive: OK (offline == on-chain view call)");

  // 2. Derive lewat chainsig (getDerivedPublicKey).
  const contract = createMpcContract("testnet");
  const viaMpc = await deriveAddressViaMpc(contract, accountId, path, "testnet");
  console.log(`MPC derive   : ${viaMpc.address} (chainsig getDerivedPublicKey — OK)`);

  // 3. MPC sign atas hash pesan.
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(message));
  console.log(`Message      : ${JSON.stringify(message)}`);
  console.log(`Payload hash : ${payloadHash}`);
  const account = createNearAccount(accountId, privateKey, "testnet");
  const signerAccount = createSignerAccount(account);
  const { signatures, latencyMs } = await signPayload(
    contract,
    signerAccount,
    ethers.getBytes(payloadHash),
    path,
    "Ecdsa",
  );
  const sig = signatures[0];
  console.log(`MPC sign latency: ${(latencyMs / 1000).toFixed(2)} s`);
  console.log(`Signature r  : 0x${sig.r}`);
  console.log(`Signature s  : 0x${sig.s}`);
  console.log(`Signature v  : ${sig.v}`);

  // 4. Verifikasi recovery offline.
  const { recoveredAddress, matches } = verifySignatureRecovery(
    ethers.getBytes(payloadHash),
    sig,
    offline.evmAddress,
  );
  console.log(`Recovered    : ${recoveredAddress}`);
  console.log(`Recovery     : ${matches ? "MATCH — tanda tangan valid untuk alamat turunan" : "MISMATCH"}`);
  if (!matches) {
    throw new Error("Recovery alamat TIDAK cocok dengan alamat turunan.");
  }
  console.log("LAYER C TERCAPAI: derive + MPC sign + recovery offline terverifikasi.");
}

main().catch((err) => {
  console.error(`VALIDASI GAGAL: ${err?.message ?? err}`);
  process.exit(1);
});
