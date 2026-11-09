# Chain Signatures — Research Notes (MintGuard)

> **Status:** riset selesai 2026-11-09 ~15:30 WIB · semua alamat kontrak & rumus derivasi
> **diverifikasi langsung ke RPC NEAR (read-only view calls)** dan terhadap kode
> `chainsig.js@1.1.16` yang sudah dipublikasikan.
> Dokumen ini adalah catatan riset — bukan janji. Angka yang ditandai "verifikasi live"
> sudah dicek hari ini; yang ditandai "ukur saat build" belum.

---

## 0. Ringkasan eksekutif

Chain Signatures adalah cara agar **satu akun NEAR mengendalikan alamat EVM
(BSC) tanpa pernah memegang seed/private key EVM**. Satu akun NEAR
(mis. `mintguard.testnet`) + satu string path (mis. `ethereum-1`) secara
deterministik menurunkan satu alamat BSC. Untuk menandatangani transaksi BSC,
agen memanggil fungsi `sign` di kontrak MPC NEAR (`v1.signer-prod.testnet` di
testnet); jaringan MPC (threshold signature, tidak ada satu node pun yang
memegang kunci penuh) mengembalikan tanda tangan ECDSA, lalu agen merakit dan
me-broadcast transaksi yang sudah ditandatangani itu ke BSC.

**Untuk MintGuard ini adalah inti produk:** agen AI (di NEAR) mem-vetting
kontrak BSC, lalu mengeksekusi free mint dari alamat BSC turunan — tanpa seed
yang bisa bocor atau dicuri lewat prompt injection. Jalur ini **realistis
dikerjakan dalam ~5 hari** (lihat verdik §8), dengan syarat validasi
testnet end-to-end dilakukan di hari pertama.

---

## 1. Aturan hackathon yang relevan (dari HACKATHON.md)

Sumber: <https://nearhackathon.com/HACKATHON.md> (dibaca penuh 2026-11-09).

| Butir | Isi | Dampak ke MintGuard |
|---|---|---|
| Deadline | Submit ditutup **14 Nov 2026 23:59 UTC = 15 Nov 06:59 WIB**. Repo publik + demo post X sebelum itu. | Sisa ~5 hari dari 9 Nov. Scope harus dipotong ke demo yang jalan. |
| **Q-010 — Testnet-only boleh** | "Testnet-only projects eligible? **Yes, all tracks.** Mainnet only where the integration is mainnet-only." | **Demo penuh boleh di NEAR testnet + BSC testnet.** Tidak ada keharusan mainnet. |
| **Q-008 — Test funds** | "Testnet NEAR is free (near-cli faucet, near-faucet.io). Mainnet costs not reimbursed by default." | Semua biaya testnet = gratis. Jangan sentuh mainnet. |
| **Q-011 — Mandatory integrations** | "None. Hints are hints. **Own contract on NEAR that fits the track is enough.**" | Tidak wajib pakai NEAR Intents / 1Click / produk partner. Chain Signatures saja cukup. |
| **Q-012 — Local-only demo OK** | "Yes: public repo, reproducible README, X post with a video; screenshots are not enough when judges cannot open the demo. Hosted demo is a plus; keep it up to 2026-11-18, ideally 2026-11-25." | Demo boleh lokal + video. Prioritaskan video demo yang merekam alur lengkap. |
| Q-006 — 1Click JWT | "Not required. Without it, 0.2% fee." | Tidak relevan — MintGuard tidak pakai Intents untuk demo. |
| Q-007 — Testnet Intents | "None exists or is planned." | Alasan tambahan untuk **tidak** memakai Intents di demo; Chain Signatures punya testnet. |
| Q-000 — NEAR AI credits | $10 gratis via NEAR Builders (<https://nearbuilders.org/join>), key di <https://cloud.near.ai>. | Opsional untuk LLM vetting di demo; vetting inti MintGuard sudah ada (off-chain, tanpa LLM). |
| Submit | Satu submission per repo, via `POST https://nearhackathon.com/api/applications` atau form. Field `tracks` berisi id. `nearAddress` = akun mainnet untuk payout hadiah (dibuat di wallet mana pun, **jangan dibuatkan/dikarang oleh agen**). | Perlu akun mainnet HANYA sebagai alamat payout (tanpa dana, tanpa transaksi) — dibuat manual oleh Rakha di wallet, bukan oleh agen. |
| Prize | Pool $250.000; grand prize $55.000; juara 1 per track $10.000. | — |
| Q-017 | Claude Code/Codex hanya screening awal; juri manusia yang memutuskan. README harus bisa dibaca mesin: "do X - see Y". | README harus berisi langkah reproduksi yang eksplisit. |

### Track yang dipilih

| id | Track | Kenapa cocok |
|---|---|---|
| `agents` | **Agent Economy** — "Give AI a wallet". Lean on: Agent commerce, NEAR Intents, **Chain Signatures**. | Track utama. Agen yang memegang uang sendiri lintas chain adalah definisi MintGuard. Prompt contoh: agen general-contractor yang memecah tugas, menyewa agen lain, membayar, dan memberi receipt. |
| `security` | **AI Security & Defense** — "Trust, but verify". Lean on: Agent security, function-call keys, TEE attestation. | Cadangan. Prompt contoh: counterparty check sebelum agen membayar (allow/warn/block) + agent-side wrapper yang menolak sign saat `block` + demo serangan prompt-injection yang digagalkan. Ini persis modul vetting MintGuard. |
| `open` | **Open Innovation** — "Build your own". | Cadangan kedua bila juri menilai MintGuard tidak murni masuk agents/security. |

Prompt contoh resmi (dibaca 2026-11-09, read-only):
- `tracks/07-agents.md` — <https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/07-agents.md>
- `tracks/06-security.md` — <https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/06-security.md>
- Repo: <https://github.com/nearai/near-hackathon-prompt-examples>

Catatan dari prompt `security`: agen harus sign dengan **function-call access
key yang di-scope ke satu kontrak, bukan full-access key** — dan README harus
menjelaskan limitasi key itu. Ini akan kita ikuti: akun agen testnet hanya
diberi function-call key ke `v1.signer-prod.testnet` (metode `sign` saja),
bukan full-access key.

---

## 2. Cara kerja Chain Signatures

Sumber utama: <https://docs.near.org/chain-abstraction/chain-signatures> dan
<https://docs.near.org/chain-abstraction/chain-signatures/implementation>
(update terakhir 26–29 Okt 2026), plus
<https://docs.near.org/chain-abstraction/chain-signatures/getting-started>.

Tiga elemen:

1. **Derivation paths** — satu string (mis. `ethereum-1`, `ethereum-2`) yang
   bersama nama akun NEAR menurunkan satu alamat di chain tujuan.
   **Bukan BIP32/BIP44.** Tidak ada jalur `m/44'/60'/...` dan tidak ada
   mnemonic di sisi manapun. Ini *additive key derivation*: kunci turunan =
   kunci master MPC + tweak, dengan tweak = hash dari
   `(nama akun NEAR, path)`. Detail rumus di §4.
2. **Multichain smart contract (kontrak MPC)** — menerima request tanda tangan
   dan mengembalikan tanda tangan yang sudah jadi.
3. **MPC service** — sekumpulan node independen; tidak ada satu node pun yang
   bisa menandatangani sendiri. Node-node membuat *signature shares* yang
   diagregasi selama beberapa ronde menjadi satu tanda tangan. Kunci privat
   tidak pernah direkonstruksi di satu mesin pun.

Alur 5 langkah (sesuai docs):

1. **Derive foreign address** — hitung alamat BSC dari (akun NEAR, path).
   Murni komputasi, offline, tanpa key.
2. **Create transaction** — rakit transaksi BSC yang belum ditandatangani
   (transfer atau function call, mis. `mint()`), ambil hash-nya (payload).
3. **Request signature** — panggil `sign` di kontrak MPC dengan
   `(payload, path, domain_id)`. Metode ini *yield* (menunggu) sementara
   jaringan MPC menandatangani.
4. **Format signature** — gabungkan tanda tangan (r, s, v) ke transaksi.
5. **Relay** — broadcast transaksi yang sudah ditandatangani ke BSC.

### Kontrak MPC — alamat (verifikasi live 2026-11-09)

| Network | Kontrak | Root public key secp256k1 (domain `0`) — dari view call `public_key` |
|---|---|---|
| **Mainnet** | `v1.signer` | `secp256k1:3tFRbMqmoa6AAALMrEFAYCEoHcqKxeW38YptwowBVBtXK1vo36HDbUWuR6EZmoK4JcH6HDkNMGGqP1ouV7VZUWya` |
| **Testnet** | `v1.signer-prod.testnet` | `secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3` |

Root key Ed25519 (domain `1`, testnet, verifikasi live):
`ed25519:6vSEtQxrQj6txUMh33WC4ERyCWmNMRTdufDWAaDY3Un2`.
Mainnet Ed25519 (dari bundle `chainsig.js`, belum dicek via RPC):
`ed25519:G9hwngxWNKdmqMCmU1Yt6LPhFpayJeKFxyAV1HqMNLtF`.

Metode view yang tersedia (terverifikasi merespons di kedua network):
- `public_key({domain_id})` → root public key MPC.
- `derived_public_key({domain_id, predecessor, path})` → kunci turunan untuk
  `(akun, path)` — berguna sebagai pembanding saat mengetes rumus derivasi.

### Jaringan MPC hari ini

- Docs lama menyebut 8 node. **State on-chain per 6 Okt 2026: 17 peserta,
  threshold 11** (dikutip dari ringkasan yang membaca state kontrak).
  Set peserta + threshold bersifat publik di kontrak dan hanya berubah lewat
  `vote_new_parameters` bila cukup banyak peserta aktif yang vote.
- Dashboard live + audit: <https://mpc.nearone.org>, audit di
  `near/mpc/audits` (GitHub).
- **Koreksi penting:** contoh alamat di docs (`example.near` +
  `ethereum-1` = `0x1b48b83a308ea4beb845db088180dc3389f8aa3b`) **sudah basi**
  — dihitung dengan root key MPC lama (sebelum rotasi). Dengan root key live
  saat ini, `example.near` + `ethereum-1` = `0xEF4Ea05e5c11057DeCC8E1bd6F5369f2acD91fA5`
  (terverifikasi §4). Selalu ambil root key dari kontrak (`public_key`),
  jangan salin contoh dari docs.

### Binding yang penting untuk desain MintGuard

- Kunci turunan diikat ke **predecessor** — yaitu akun yang *memanggil*
  `sign`, bukan akun sembarang yang namanya ditulis di argumen. Jadi:
  - Kalau **agen off-chain** (script dengan key akun `mintguard.testnet`)
    yang memanggil `sign`, alamat BSC turunannya milik `mintguard.testnet`.
  - Kalau **smart contract NEAR** yang memanggil `sign`, predecessor-nya
    adalah akun kontrak itu — alamat BSC turunannya milik kontrak.
- Tidak ada akun NEAR lain yang bisa meminta tanda tangan untuk alamat
  turunan kita: path di-namespace oleh nama akun pemanggil.
- Satu akun NEAR bisa menurunkan banyak alamat (satu per path):
  `ethereum-1`, `ethereum-2`, …, atau path per pengguna / per kampanye
  (mis. `mintguard:bsc:<id-mint>`). Path adalah string bebas.

---

## 3. SDK — nama & versi yang masih didukung (Nov 2026)

Diverifikasi 2026-11-09 lewat npm registry (`registry.npmjs.org/.../latest`).
Semua paket di bawah ini **tidak deprecated**.

| Paket | Versi latest (9 Nov 2026) | Peran di MintGuard |
|---|---|---|
| `chainsig.js` | **1.1.16** | Library resmi-contoh untuk Chain Signatures: adapter EVM/BTC/Sol/dll + `ChainSignatureContract`. **Pilihan utama.** |
| `near-api-js` | **7.4.0** | SDK monolitik NEAR (masih didukung, tidak deprecated). |
| `@near-js/client` | **2.5.1** | SDK NEAR modular (pengganti `near-api-js` untuk kode baru). |
| `@near-js/crypto`, `@near-js/accounts`, `@near-js/keystores`, `@near-js/providers`, `@near-js/signers`, `@near-js/transactions`, `@near-js/utils` | **2.5.1** (satu versi untuk semua) | Dipakai langsung oleh `chainsig.js` (ia me-require `^2.2.4`). **Pakai ini, bukan `near-api-js`, untuk kode baru** — konsisten dengan dependensi `chainsig.js`. |
| `@hot-labs/near-connect` | **0.12.0** | Koneksi wallet di frontend (dipakai contoh docs). Tidak perlu untuk agen CLI. |
| `viem` | **2.57.17** | Client EVM (RPC BSC, `publicClient`). `chainsig.js` me-require `^2.22.14`. |
| `ethers` | **6.17.0** | Alternatif viem untuk encode calldata + rakit tx. Sudah jadi dependensi MintGuard (`^6.13.0`). |

Dependensi `chainsig.js@1.1.16` (dari `package.json` paket yang dipublikasikan;
relevan untuk kita): `@near-js/* ^2.2.4`, `viem ^2.22.14`, `elliptic ^6.6.1`,
`js-sha3 ^0.9.3`, `bs58 ^6.0.0`, `bn.js ^5.2.1`, `@noble/curves`, `@noble/hashes`.

### Peringatan versi: README `chainsig.js` vs kode rilis

README di GitHub (`NearDeFi/chainsig.js`) menampilkan contoh `contract.sign()`
dengan bentuk lama — `{payload, path, key_version}`. **Kode rilis 1.1.16
(yang benar-benar ter-install) memakai bentuk berbeda** (dikonfirmasi dengan
membaca bundle `dist` paket yang dipublikasikan):

```ts
contract.sign({
  payloads: [hash32bytes],   // array of payloads, bukan `payload` tunggal
  path: "ethereum-1",
  keyType: "Ecdsa",          // "Ecdsa" | "Eddsa", bukan `key_version`
  signerAccount,             // { accountId, signAndSendTransactions }
});
```

Di balik layar, `sign` mengirim function call ke kontrak MPC dengan:

- method `sign`, args
  `{request: {payload_v2: {Ecdsa: <32-byte hash>}, path, domain_id: 0}}`
  (`domain_id` `0` = Secp256k1, `1` = Ed25519),
- **prepaid gas 300 TGas** (maksimum per call),
- **attached deposit 1 yoctoNEAR** (`getCurrentSignatureDeposit()` mengembalikan `1`).

Jangan salin contoh dari README tanpa memeriksa typedoc
(<https://neardefi.github.io/chainsig.js>) atau bundle rilis.

---

## 4. Rumus derivasi alamat EVM — terverifikasi terhadap on-chain

### Rumus (persis seperti di `chainsig.js@1.1.16`)

```
epsilon = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:{predecessor},{path}")
          (sebagai bilangan bulat 256-bit, big-endian)
childPoint = rootPoint + epsilon * G        (penjumlahan titik secp256k1)
```

Keterangan yang sering salah:

- Hash-nya **SHA3-256, bukan SHA-256** (NIST SHA-3, `js-sha3`).
- Ada **prefix domain** `"near-mpc-recovery v0.1.0 epsilon derivation:"`.
- String yang di-hash: `"{nama-akun-NEAR},{path}"`, mis. `"example.testnet,ethereum-1"`.
- Kunci publik NEAR secp256k1 disimpan sebagai **64 byte `x || y`** (tanpa
  prefix `0x04`). Untuk komputasi EC, tambahkan prefix `04` menjadi
  uncompressed 65-byte; untuk alamat EVM, ambil `keccak256(x || y)` lalu
  20 byte terakhir (dengan checksum EIP-55).
- Ini **bukan BIP32**: tidak ada chain code, tidak ada hardened path, tidak
  ada mnemonic. Satu-satunya input adalah nama akun + string path + root key
  MPC publik.

### Bukti verifikasi (dilakukan 2026-11-09, skrip di `/tmp/mintguard-kdf/`)

Perhitungan offline dengan rumus di atas, dibandingkan dengan view call
`derived_public_key` di kontrak MPC:

| Kasus | Hasil offline | Hasil on-chain (`derived_public_key`) | Cocok? |
|---|---|---|---|
| testnet `example.testnet` + `ethereum-1` | `secp256k1:mtY14KMe3TZggrVhPwjM1Z68WKTXDMYNwNjyMTGzioKV3qJhFZ4LZ41KCe5RUNCjC3EGjS5wpZdzGJ5JZ1Dhab5` | sama persis | ✅ |
| mainnet `example.near` + `ethereum-1` | `secp256k1:5zL9u9afiFPPrPmnH7rEz2t3szev5eZ7wXCwzYq37GYyCbJq3YNU31N4LTULioaw3chJx674XUncmYKiSCd3AxxT` | sama persis | ✅ |

Alamat EVM yang dihasilkan (dihitung dari kunci turunan di atas):

| Kasus | Alamat EVM turunan |
|---|---|
| testnet `example.testnet` + `ethereum-1` | `0xD8ebbAA4f6558cc6b322987194Fd663a976272bD` |
| mainnet `example.near` + `ethereum-1` | `0xEF4Ea05e5c11057DeCC8E1bd6F5369f2acD91fA5` |

Contoh runnable: `src/signing/example-derive.ts` (offline, tanpa key, tanpa
network — jalankan `npx tsx src/signing/example-derive.ts`). File itu
menegaskan sendiri (self-check) bahwa hasil default sama dengan nilai di atas;
kalau root key MPC berubah di masa depan, self-check akan gagal dan memberi
tahu — itulah sinyal untuk mengambil root key terbaru dari kontrak.

---

## 5. Contoh kode minimal (alurnya, bukan salin-tempel buta)

### (a) Derive alamat EVM dari akun NEAR — offline

Lihat file jadi: [`src/signing/example-derive.ts`](../src/signing/example-derive.ts).
Inti rumusnya (TypeScript, dependensi: `elliptic`, `js-sha3`, `bs58`, `ethers`):

```ts
import { ec as EC } from "elliptic";
import { sha3_256 } from "js-sha3";
import bs58 from "bs58";
import BN from "bn.js";
import { ethers } from "ethers";

const ec = new EC("secp256k1");

// Root key MPC testnet — KONSTANTA PUBLIK (bukan secret), verifikasi live 2026-11-09.
// Kalau self-check di example-derive.ts gagal, ambil ulang via view call `public_key`.
const TESTNET_ROOT = "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3";

function deriveEvmAddress(rootPublicKey: string, predecessor: string, path: string): string {
  const rootBytes = bs58.decode(rootPublicKey.split(":")[1]); // 64 byte x||y
  const parent = ec.keyFromPublic("04" + Buffer.from(rootBytes).toString("hex"), "hex");
  const epsilon = new BN(
    sha3_256(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`),
    16,
  );
  const child = parent.getPublic().add(ec.g.mul(epsilon));
  const x = child.getX().toString("hex").padStart(64, "0");
  const y = child.getY().toString("hex").padStart(64, "0");
  return ethers.computeAddress("0x" + x + y); // keccak256(x||y)[12:] + checksum EIP-55
}
```

### (b) Minta tanda tangan MPC atas hash transaksi EVM

Menggunakan `chainsig.js@1.1.16` (API yang terverifikasi dari bundle rilis,
bukan dari README yang sudah basi — lihat §3). Key akun NEAR testnet hanya
dibaca dari environment (`.env.local`, gitignored), **tidak pernah ditulis di
repo**.

```ts
import { chainAdapters, contracts } from "chainsig.js";
import { KeyPair, type KeyPairString } from "@near-js/crypto";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";

// --- Setup (testnet). Key HANYA dari env; file ini tidak berisi secret. ---
const accountId = process.env.NEAR_ACCOUNT_ID!;              // mis. mintguard.testnet
const keypair = KeyPair.fromString(process.env.NEAR_PRIVATE_KEY as KeyPairString);

const contract = new contracts.near.ChainSignatureContract({
  networkId: "testnet",
  contractId: "v1.signer-prod.testnet",
  accountId,
  keypair,
});

const publicClient = createPublicClient({
  chain: bscTestnet, // chainId 97
  transport: http("https://data-seed-prebsc-1-s1.binance.org:8545"),
});

const evm = new chainAdapters.evm.EVM({ publicClient, contract });

// --- (a) Derive alamat (sama hasilnya dengan example-derive.ts) ---
const { address, publicKey } = await evm.deriveAddressAndPublicKey(accountId, "ethereum-1");

// --- Siapkan transaksi: panggil mint() di kontrak BSC testnet ---
// `data` = calldata hasil encode (mis. ethers.Interface.encodeFunctionData("mint()")).
// `from` = alamat turunan di atas; value 0 untuk free mint; gas diisi dari estimasi RPC.
const { transaction, hashesToSign } = await evm.prepareTransactionForSigning({
  from: address,
  to: "0x...",        // kontrak NFT di BSC testnet (deploy sendiri saat demo)
  value: 0n,
  data: "0x...",      // calldata mint()
});

// --- (b) Minta tanda tangan MPC atas hash transaksi ---
// Di balik layar: function call `sign` ke v1.signer-prod.testnet,
// prepaid gas 300 TGas, deposit 1 yoctoNEAR. Metode ini menunggu (yield)
// sampai jaringan MPC selesai menandatangani — ukur latensinya saat build.
const [signature] = await contract.sign({
  payloads: [hashesToSign[0].payload], // hash 32-byte dari transaksi unsigned
  path: "ethereum-1",
  keyType: "Ecdsa",
  signerAccount: contract["signerAccount"], // lihat catatan di bawah
});
```

Catatan API (jujur soal yang belum 100% pasti dari bundle):

- Bentuk `signerAccount` di `chainsig.js` adalah
  `{accountId, signAndSendTransactions}` — di contoh wallet (frontend) ini
  datang dari `@hot-labs/near-connect`. Untuk agen CLI (Node), objek ini
  harus dibangun dari `@near-js/accounts` + `KeyPair` (full-access key akun
  testnet) — **pola pastinya harus dikonfirmasi ke typedoc / folder
  `examples/` repo `chainsig.js` saat build (Day 1)**. Ini satu-satunya
  bagian API yang belum terpegang contoh running-nya.
- `prepareTransactionForSigning` mengembalikan `{transaction, hashesToSign}`.
  Field yang diterima untuk function call (`data`, `gasLimit`, `maxFeePerGas`,
  dsb.) mengikuti tipe adapter EVM — konfirmasi ke typedoc saat build; jangan
  berasumsi semua field `ethers`/`viem` diterima apa adanya.

### (c) Rakit + broadcast transaksi BSC yang sudah ditandatangani

```ts
// --- (c) Gabungkan tanda tangan ke transaksi, lalu broadcast ke BSC testnet ---
const signedTx = evm.finalizeTransactionSigning({
  transaction,
  rsvSignatures: [signature], // { r, s, v } dari MPC
});

const { hash } = await evm.broadcastTx(signedTx);
console.log("BSC testnet tx:", `https://testnet.bscscan.com/tx/${hash}`);
```

Rangkaian lengkapnya: derive (offline) → siapkan tx → `sign` (MPC) →
`finalizeTransactionSigning` → `broadcastTx`. Tidak ada private key EVM di
langkah mana pun.

---

## 6. Biaya

### NEAR — per panggilan MPC `sign`

| Komponen | Nilai | Sumber |
|---|---|---|
| Attached deposit | **1 yoctoNEAR** (0,000…001 NEAR — praktis nol) | `getCurrentSignatureDeposit()` di bundle `chainsig.js@1.1.16` |
| Prepaid gas | **300 TGas** (maksimum per call; yang tidak terpakai dikembalikan) | Sama — konstanta di bundle |
| Gas yang benar-benar terbakar | **~7 TGas** per `sign` (estimasi komunitas; harga gas floor 0,0001 NEAR/TGas → ~0,0007 NEAR per tanda tangan) | Ringkasan komunitas yang membaca kontrak; **ukur ulang saat build** |
| Biaya MPC terpisah | **Tidak ada** — docs: "You can sign transactions on NEAR for free" (di luar gas NEAR biasa) | <https://docs.near.org/chain-abstraction/chain-signatures/getting-started> ("How much does it cost?") |

Koreksi atas info lama: metode view `experimantal_signature_deposit()` /
`experimental_signature_deposit()` yang disebut di README fork lama
**sudah tidak ada di kontrak live** (kedua network mengembalikan
`MethodNotFound` saat dicek 2026-11-09). Artinya mekanisme "deposit dinamis
per tanda tangan" sudah dihapus — yang tersisa hanya gas NEAR + 1 yocto.
Jangan mengutip angka deposit lama dari tutorial 2024/2025.

### NEAR — biaya sekali jalan (testnet, gratis)

| Kebutuhan | Biaya |
|---|---|
| Akun testnet `*.testnet` | Gratis via faucet (lihat §7). Satu akun cukup untuk seluruh demo. |
| Deploy kontrak NEAR sendiri (opsional — reputasi agen on-chain) | Storage + gas, dibayar dengan testnet NEAR dari faucet. Estimasi kasar: deploy kontrak kecil < 1 NEAR. |
| Panggilan `sign` selama demo (puluhan kali) | < 0,1 NEAR total. |

### BSC testnet — gas untuk transaksi yang ditandatangani MPC

- Gas dibayar dengan **tBNB** di alamat BSC turunan (bukan dengan NEAR).
  Mint gratis tetap butuh gas BSC testnet (~0,00002–0,00005 tBNB per mint
  sederhana, mengikuti tarif BSC).
- tBNB diambil dari faucet lalu dikirim ke alamat turunan (lihat §7 —
  ada jebakan filter bot di faucet resmi).

### Mainnet (untuk konteks saja — TIDAK dipakai di demo)

- `sign` di mainnet: biaya yang sama secara struktur (gas NEAR + 1 yocto).
  Gas NEAR mainnet dibayar dengan NEAR asli; gas BSC mainnet dibayar dengan
  BNB asli. **Demo tidak menyentuh mainnet.**

---

## 7. Faucet & RPC gratis

### NEAR testnet — dana gratis

| Cara | Keterangan |
|---|---|
| **<https://near-faucet.io>** (faucet komunitas) | Klaim ~2 NEAR per request (cek 8 Nov 2026); sumber lain menyebut hingga 100 NEAR per ~30 menit. Mendukung NEAR + beberapa token testnet (USDT, USDC, ETH). Cukup untuk seluruh demo. |
| **Faucet resmi di docs** — <https://docs.near.org/getting-started/faucet> | Masukkan nama akun, klik Request; jumlah kecil. |
| **<https://faucet.testnet.near.org>** | Faucet web resmi; ~100 NEAR per akun per ~6 jam (menurut panduan komunitas). |
| **`near-cli-rs`** (pengganti `near-cli` lama) | `npm i -g near-cli-rs@latest`, lalu `near account create-account sponsor-by-faucet-service <nama>.testnet` — akun langsung dibuat + didanai faucet. |
| **Legacy `near-cli`** | `near faucet <nama>.testnet --networkId testnet`. |
| **Explorer testnet** (`explorer.testnet.near.org`) + **bot Discord `#testnet-faucet`** | Alternatif bila faucet web sedang maintenance (~50 NEAR via bot). |

### NEAR — RPC publik gratis

| Network | Endpoint utama | Cadangan gratis |
|---|---|---|
| Testnet | `https://rpc.testnet.near.org` (dipakai untuk semua verifikasi di riset ini) | `https://test.rpc.fastnear.com`, `https://near-testnet.drpc.org`, `https://testnet-rpc.intea.rs` |
| Mainnet | `https://rpc.mainnet.near.org` | `https://free.rpc.fastnear.com`, `https://near.drpc.org` |

Daftar lengkap + limit: <https://docs.near.org/api/rpc/providers>
(update 22 Okt 2026). Catatan: `archival-rpc.*.near.org` severely rate-limited;
untuk demo cukup RPC biasa. `nearcore` tidak mendukung JSON-RPC batch.

### BSC testnet (Chapel) — untuk kaki eksekusi demo

| Item | Nilai |
|---|---|
| Chain ID | **97** (0x61). Mainnet 56 — jangan tertukar. |
| RPC publik | `https://data-seed-prebsc-1-s1.binance.org:8545` (resmi; rate limit 10.000 req / 5 mnt, kadang `eth_getLogs` dimatikan). Cadangan: `https://bsc-testnet-dataseed.bnbchain.org`, `https://bsc-testnet-rpc.publicnode.com`, `https://bnb-testnet.api.onfinality.io/public`. |
| Explorer | `https://testnet.bscscan.com` |
| Faucet resmi | `https://testnet.bnbchain.org/faucet-smart` — **0,1–0,5 tBNB per 24 jam** (angka bervariasi antar sumber; cek saat build). |
| **Jebakan faucet** | Faucet resmi menerapkan filter bot: alamat yang meminta **harus memegang ≥ 0,002 BNB di BSC mainnet** (cek Sep 2026). Alamat turunan MPC yang baru dibuat memegang 0 — **jadi jangan minta tBNB langsung ke alamat turunan**. Pola yang benar: minta tBNB ke wallet yang sudah ada (mis. wallet Rakha), lalu kirim tBNB itu ke alamat turunan di testnet. |

### Akun testnet — status saat riset ini ditulis

**Belum dibuat.** Semua verifikasi di riset ini memakai read-only RPC
(view calls) dan komputasi offline, jadi belum butuh akun. Akun testnet
(`mintguard.testnet` atau sejenis) dibuat pada fase build (Day 1) dengan
`near-cli-rs` + faucet, dan key-nya disimpan **HANYA** di `.env.local`
(sudah di-gitignore: `.env.*`). Tidak ada transaksi mainnet, tidak ada akun
mainnet yang dibuat dalam riset ini.

---

## 8. VERDIK: realistis dalam ~5 hari?

### Ya — dengan scope demo testnet yang disiplin

| Aspek | Penilaian |
|---|---|
| **Derivasi alamat** | ✅ **Terbukti hari ini.** Rumus offline cocok 100% dengan on-chain di kedua network. Contoh runnable sudah ada (`src/signing/example-derive.ts`). |
| **Kontrak MPC** | ✅ **Live & gratis di testnet.** Alamat, metode, dan biaya terverifikasi via RPC. Tidak ada biaya per tanda tangan selain gas NEAR. |
| **SDK** | ✅ `chainsig.js@1.1.16` + `@near-js/*@2.5.1` + `viem@2.57` tersedia dan tidak deprecated. Contoh resmi di docs memakai stack yang sama. |
| **Aturan hackathon** | ✅ Testnet-only eligible (Q-010), tanpa integrasi wajib (Q-011), demo lokal + video cukup (Q-012). |
| **Biaya** | ✅ Nol rupiah: faucet NEAR + faucet tBNB. |
| **Waktu** | ⚠️ Ketat tapi cukup untuk **satu alur demo end-to-end** (vet → derive → sign → mint di BSC testnet → tampilkan hasil). Bukan untuk produk lengkap. |

### Blocker konkret (urut risiko)

1. **API `signerAccount` untuk agen CLI belum terpegang contoh running-nya.**
   Contoh docs memakai wallet browser (`@hot-labs/near-connect`); agen CLI
   harus merakit `{accountId, signAndSendTransactions}` dari `@near-js/*`.
   Ini satu-satunya bagian yang belum pasti — **validasi Day 1, jam pertama.**
   Kalau pola ini mentok >2 jam, fallback: panggil `sign` langsung via
   `@near-js/accounts` `account.functionCall()` mentah (tanpa `chainsig.js`
   untuk langkah sign), karena bentuk function call-nya sudah diketahui
   persis dari bundle (§3).
2. **Latensi `sign` MPC belum diukur.** Metode ini yield menunggu jaringan
   MPC; estimasi komunitas "beberapa detik", tapi belum ada angka testnet
   yang terukur dari kita. Kalau ternyata 30–60 detik per tanda tangan,
   demo tetap jalan (tunjukkan progress), tapi alur "1 detik trigger"
   ala free-mint BSC tidak berlaku di sini. Ukur Day 1.
3. **Faucet tBNB punya filter bot (≥0,002 BNB mainnet).** Bukan blocker
   keras — atasi dengan pola kirim dari wallet yang sudah ada (§7) — tapi
   harus disiapkan sebelum demo, bukan saat demo.
4. **README `chainsig.js` basi** (bentuk `sign` lama). Risiko salah salin
   contoh. Mitigasi: pakai §3 + §5 dokumen ini (dari bundle rilis) dan
   typedoc resmi sebagai rujukan, bukan README.
5. **Contoh alamat di docs.near.org basi** (root key lama). Risiko: demo
   menampilkan alamat yang salah bila menyalin contoh docs. Mitigasi:
   selalu derive dari root key live / pakai `example-derive.ts` (ada
   self-check).
6. **Waktu: ~5 hari termasuk submit.** Scope harus dipotong: satu alur
   demo, satu kontrak NFT testnet sederhana untuk target mint, satu kontrak
   NEAR reputasi yang minimal (atau bahkan reputasi sebagai catatan
   off-chain dulu bila kontrak NEAR memakan waktu). Jangan tambah fitur
   di tengah jalan.

### Rencana fallback (berlapis, dari yang paling penuh ke yang paling minimal)

| Lapisan | Isi | Kapan dipakai |
|---|---|---|
| **A — Penuh (target)** | Vet (sudah ada) → derive alamat → `sign` MPC testnet → broadcast mint ke BSC testnet → NFT testnet diterima di alamat turunan → tampilkan di demo + explorer. | Jika validasi Day 1 (blocker #1, #2) lolos. |
| **B — Tanpa broadcast BSC** | Semua langkah A kecuali broadcast: tunjukkan tanda tangan MPC yang valid atas hash transaksi (verifikasi tanda tangan bisa dicek offline dengan `ethers.verifyMessage`/recovery) + transaksi unsigned yang siap broadcast. Bukti kriptografis lengkap, tinggal relay. | Jika broadcast ke BSC testnet bermasalah (faucet/RPC) tapi `sign` jalan. |
| **C — Derive + sign pesan** | Derive alamat (offline, terverifikasi) + `sign` MPC atas hash pesan arbitrer (bukan transaksi) + verifikasi recovery alamat dari tanda tangan. Ini membuktikan "akun NEAR mengendalikan alamat EVM" tanpa perlu BSC sama sekali. | Jika langkah BSC tersendat. Tetap demo yang jujur dan bisa direproduksi juri. |
| **D — Derive offline saja** | Hanya `example-derive.ts` + perbandingan dengan `derived_public_key` on-chain (sudah terbukti hari ini). | Keadaan darurat (mis. MPC testnet down). Bukan demo yang kuat — hanya bila semua di atas gagal. |

Aturan fallback: **turun satu lapisan bila satu blocker memakan >3 jam
tanpa progres**, jangan menghabiskan satu hari penuh untuk satu blocker.
Demo yang jalan di lapisan B/C lebih baik daripada lapisan A yang setengah
jadi saat deadline.

### Rencana 5 hari (garis besar)

- **Day 1 (10 Nov):** Buat akun testnet + danai via faucet. Validasi
  `signerAccount` CLI + ukur latensi `sign` (satu `sign` pesan testnet).
  Deploy kontrak NFT testnet sederhana di BSC testnet (target mint).
  Keputusan: lapisan A/B/C.
- **Day 2–3:** Rangkai agen: vetting (sudah ada) → derive → sign → broadcast
  → catat receipt. Kontrak NEAR reputasi minimal (skor vetting per agen).
  Rekam video demo.
- **Day 4:** README "do X - see Y", rapikan repo, uji reproduksi dari clone
  bersih. Draf demo post X.
- **Day 5 (14 Nov):** Publikasikan repo, Rakha posting demo X, submit
  (payload dicek Rakha dulu — satu kali submit, tidak bisa diulang).

---

## 9. Catatan keamanan (untuk desain MintGuard)

- **Tidak ada seed/private key EVM di mana pun.** Satu-satunya key yang
  ada adalah key akun NEAR testnet (di `.env.local`, gitignored). Key itu
  pun sebaiknya **function-call key** yang di-scope ke
  `v1.signer-prod.testnet` metode `sign` saja (sesuai prompt track
  `security`), bukan full-access key — jadi kalaupun key bocor, yang bisa
  dilakukan penyerang hanyalah meminta tanda tangan untuk alamat turunan
  akun itu sendiri (bukan memindahkan NEAR atau menambah key).
- **Predecessor binding** (§2) berarti smart contract NEAR yang memanggil
  `sign` mengendalikan alamat turunannya sendiri — cocok untuk agen
  on-chain yang otonom, dan tidak bisa dibajak oleh akun lain.
- **MPC bukan kustodian:** tidak ada satu pihak pun yang memegang kunci
  penuh; threshold 11 dari 17 (mainnet, Okt 2026). Tetap catat di README
  bahwa keamanan bergantung pada asumsi threshold MPC NEAR — jujur soal
  batasannya.
- **Reputasi on-chain** (modul 3 MintGuard): skor vetting ditulis ke
  kontrak NEAR sendiri (bukan ke kontrak MPC). Kontrak MPC hanya
  menandatangani; logika bisnis tetap di kontrak MintGuard.

---

## 10. Sumber

- HACKATHON.md (live): <https://nearhackathon.com/HACKATHON.md>
- What are Chain Signatures?: <https://docs.near.org/chain-abstraction/chain-signatures>
- Signing Transactions (implementation): <https://docs.near.org/chain-abstraction/chain-signatures/implementation>
- Getting Started: <https://docs.near.org/chain-abstraction/chain-signatures/getting-started>
- RPC providers: <https://docs.near.org/api/rpc/providers>
- Token faucet: <https://docs.near.org/getting-started/faucet>
- chainsig.js repo: <https://github.com/NearDeFi/chainsig.js> · npm `chainsig.js@1.1.16` · typedoc <https://neardefi.github.io/chainsig.js>
- Prompt contoh track: <https://github.com/nearai/near-hackathon-prompt-examples> (`tracks/06-security.md`, `tracks/07-agents.md`)
- MPC dashboard/audit: <https://mpc.nearone.org>
- BSC testnet: RPC `https://data-seed-prebsc-1-s1.binance.org:8545`, faucet `https://testnet.bnbchain.org/faucet-smart`, explorer `https://testnet.bscscan.com`
- NEAR testnet faucet: <https://near-faucet.io>, <https://faucet.testnet.near.org>

## 11. Log verifikasi

- 2026-11-09 ~15:22 WIB: baca penuh HACKATHON.md (483 baris) + prompt
  track `agents` & `security`.
- 2026-11-09 ~15:25 WIB: view call `public_key` (domain 0 & 1) +
  `derived_public_key` ke `v1.signer` (mainnet) dan
  `v1.signer-prod.testnet` (testnet) via `rpc.mainnet.near.org` /
  `rpc.testnet.near.org` — semua merespons.
- 2026-11-09 ~15:26 WIB: `experimantal_signature_deposit` dan
  `experimental_signature_deposit` → `MethodNotFound` di kedua network
  (metode deposit dinamis sudah tidak ada).
- 2026-11-09 ~15:27 WIB: rumus KDF dibaca dari bundle `chainsig.js@1.1.16`
  (fungsi epsilon `sha3_256` + prefix domain) lalu diuji offline:
  derivasi cocok persis dengan `derived_public_key` on-chain di testnet
  dan mainnet. Dua jebakan ditemukan saat verifikasi: (1) kunci NEAR
  secp256k1 = 64 byte `x||y` (bukan 33 byte compressed);
  (2) contoh alamat di docs.near.org memakai root key lama.
- 2026-11-09 ~15:28 WIB: versi paket dicek via npm registry —
  `chainsig.js 1.1.16`, `near-api-js 7.4.0`, `@near-js/* 2.5.1`,
  `@hot-labs/near-connect 0.12.0`, `viem 2.57.17`, `ethers 6.17.0`.
- Belum dilakukan (fase build): pembuatan akun testnet, `sign` live,
  pengukuran latensi MPC, broadcast ke BSC testnet.
