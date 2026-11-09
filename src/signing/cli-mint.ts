/**
 * MintGuard — CLI alur penuh Layer A: deploy NFT demo + free mint via MPC.
 *
 *   npx tsx src/signing/cli-mint.ts [--contract <0x...>] [--skip-deploy]
 *
 * Tanpa --contract: deploy MintGuardDemoNFT dulu (1 MPC sign), lalu mint
 * (1 MPC sign). Dengan --contract: langsung mint di kontrak yang sudah ada.
 *
 * Langkah per transaksi: prepare (viem) -> sign MPC (latensi diukur) ->
 * finalize -> broadcast -> receipt -> verifikasi ownerOf(tokenId).
 *
 * PRASYARAT: alamat turunan harus punya tBNB untuk gas. Bila saldo 0,
 * CLI berhenti SETELAH menyiapkan transaksi unsigned + tanda tangan MPC
 * yang valid atas hash-nya (Layer B — bukti kriptografis lengkap, tinggal
 * relay saat ada tBNB). Tidak ada broadcast tanpa gas.
 *
 * Key HANYA dari .env.local (gitignored). Testnet-only (chainId 97).
 */
import { ethers } from "ethers";
import { DEFAULT_PATH, deriveEvmAddress } from "./derive.js";
import {
  createMpcContract,
  createNearAccount,
  createSignerAccount,
  getNearCredentials,
  signPayload,
  verifySignatureRecovery,
} from "./mpc.js";
import {
  BSC_TESTNET_EXPLORER,
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
} from "./broadcast.js";
import { compileNftContract } from "./nft-contract.js";

function parseArgs(argv: string[]): { contract?: string; skipDeploy: boolean } {
  let contract: string | undefined;
  let skipDeploy = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--contract" && argv[i + 1]) contract = argv[++i];
    else if (argv[i] === "--skip-deploy") skipDeploy = true;
  }
  return { contract, skipDeploy };
}

async function main(): Promise<void> {
  const { contract: existingContract, skipDeploy } = parseArgs(process.argv.slice(2));
  const { accountId, privateKey } = getNearCredentials();
  const { evmAddress: derivedAddress } = deriveEvmAddress(accountId, DEFAULT_PATH, "testnet");
  console.log(`NEAR account : ${accountId}`);
  console.log(`Derived addr : ${derivedAddress}`);
  console.log(`Explorer     : ${BSC_TESTNET_EXPLORER}/address/${derivedAddress}`);

  const publicClient = createBscTestnetClient();
  const chainId = await publicClient.getChainId();
  assertBscTestnetChainId(chainId);
  console.log(`BSC chainId  : ${chainId} (testnet OK)`);

  const balance = await publicClient.getBalance({ address: derivedAddress as `0x${string}` });
  console.log(`tBNB balance : ${ethers.formatEther(balance)} tBNB`);
  const hasGas = balance > 0n;

  const contract = createMpcContract("testnet");
  const account = createNearAccount(accountId, privateKey, "testnet");
  const signerAccount = createSignerAccount(account);
  const evm = createEvmAdapter(publicClient, contract);

  /** Satu putaran MPC-sign + (opsional) broadcast untuk satu tx request. */
  async function mpcSignAndBroadcast(
    label: string,
    request: Parameters<typeof prepareTxForSigning>[1],
  ): Promise<{ txHash?: string; signedTx?: string; payloadHash?: string }> {
    const { transaction, hashesToSign } = await prepareTxForSigning(evm, request);
    const payload = hashesToSign[0];
    const payloadBytes = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
    const payloadHash = "0x" + Buffer.from(payloadBytes).toString("hex");
    console.log(`[${label}] payload hash: ${payloadHash}`);
    const { signatures, latencyMs } = await signPayload(
      contract,
      signerAccount,
      payloadBytes,
      DEFAULT_PATH,
      "Ecdsa",
    );
    console.log(`[${label}] MPC sign latency: ${(latencyMs / 1000).toFixed(2)} s`);
    const { recoveredAddress, matches } = verifySignatureRecovery(
      payloadBytes,
      signatures[0],
      derivedAddress,
    );
    console.log(`[${label}] recovery: ${recoveredAddress} (${matches ? "MATCH" : "MISMATCH"})`);
    if (!matches) throw new Error(`[${label}] recovery tidak cocok — batal.`);
    const signedTx = finalizeTx(evm, transaction, signatures);
    if (!hasGas) {
      console.log(`[${label}] TANPA tBNB — Layer B: tx unsigned+signed siap broadcast:`);
      console.log(`[${label}] signedTx: ${signedTx}`);
      return { signedTx, payloadHash };
    }
    const { hash } = await broadcastSignedTx(evm, signedTx);
    console.log(`[${label}] broadcast: ${hash} (${explorerTxUrl(hash)})`);
    const receipt = await waitForReceipt(publicClient, hash as `0x${string}`);
    console.log(
      `[${label}] receipt: status=${receipt.status} block=${receipt.blockNumber} gasUsed=${receipt.gasUsed}`,
    );
    if (receipt.status !== "success") throw new Error(`[${label}] tx gagal on-chain.`);
    return { txHash: hash, signedTx, payloadHash };
  }

  // --- 1. Deploy (kecuali kontrak sudah diberikan / skip) ---
  let nftAddress = existingContract;
  if (!nftAddress && !skipDeploy) {
    const { bytecode } = compileNftContract();
    console.log("Deploy MintGuardDemoNFT via MPC...");
    const deploy = await mpcSignAndBroadcast("deploy", {
      from: derivedAddress as `0x${string}`,
      data: bytecode,
      value: 0n,
    } as Parameters<typeof prepareTxForSigning>[1]);
    if (!deploy.txHash) {
      console.log("LAYER B TERCAPAI: deploy siap broadcast, menunggu tBNB.");
      return;
    }
    const receipt = await publicClient.getTransactionReceipt({
      hash: deploy.txHash as `0x${string}`,
    });
    nftAddress = receipt.contractAddress ?? undefined;
    console.log(`Contract deployed: ${nftAddress}`);
    console.log(`Explorer         : ${BSC_TESTNET_EXPLORER}/address/${nftAddress}`);
  }
  if (!nftAddress) {
    throw new Error("Tidak ada alamat kontrak NFT (pakai --contract <0x...> atau deploy).");
  }

  // --- 2. Mint gratis ---
  const iface = new ethers.Interface(["function mint() returns (uint256)"]);
  const mintData = iface.encodeFunctionData("mint");
  console.log(`Mint di ${nftAddress} ...`);
  const mint = await mpcSignAndBroadcast("mint", {
    from: derivedAddress as `0x${string}`,
    to: nftAddress as `0x${string}`,
    data: mintData as `0x${string}`,
    value: 0n,
  });
  if (!mint.txHash) {
    console.log("LAYER B TERCAPAI: mint siap broadcast, menunggu tBNB.");
    return;
  }

  // --- 3. Verifikasi kepemilikan ---
  const total = await readTotalSupply(publicClient, nftAddress as `0x${string}`);
  console.log(`totalSupply pasca-mint: ${total}`);
  const owner = await readOwnerOf(publicClient, nftAddress as `0x${string}`, total);
  console.log(`ownerOf(${total}): ${owner}`);
  if (owner.toLowerCase() !== derivedAddress.toLowerCase()) {
    throw new Error("ownerOf TIDAK sama dengan alamat turunan.");
  }
  console.log(
    `LAYER A TERCAPAI: NFT #${total} dimiliki ${derivedAddress} — https://testnet.bscscan.com/token/${nftAddress}?a=${total}`,
  );
}

main().catch((err) => {
  console.error(`GAGAL: ${err?.message ?? err}`);
  process.exit(1);
});
