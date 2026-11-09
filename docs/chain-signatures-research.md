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

const contract = new contracts.ChainSignatureContract({
  networkId: "testnet",
  contractId: "v1.signer-prod.testnet",
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

- **TERKONFIRMASI Day-1 (2026-11-09, `src/signing/mpc.ts`):** bentuk
  `signerAccount` untuk agen CLI adalah
  `{accountId, signAndSendTransactions}` yang dibangun dari
  `@near-js/accounts@2.5.1` — `Account.signAndSendTransactions({transactions:
  [{receiverId, actions}]})` sudah ada secara native dan bentuknya persis
  yang dipanggil `chainsig.js` (ia mengirim
  `{transactions: [{signerId, receiverId, actions}]}`; field `signerId`
  dibuang adapter karena signer sudah implisit dari `Account`). Tidak perlu
  `@hot-labs/near-connect` (wallet browser) untuk agen CLI. Konstruktor
  `ChainSignatureContract` HANYA menerima `{contractId, networkId,
  fallbackRpcUrls}` — **tidak ada `accountId`/`keypair` di konstruktor**
  (contoh §5(b) di versi awal dokumen ini sempat menulis keduanya dan
  `contracts.near.ChainSignatureContract` — keduanya SALAH; yang benar
  `contracts.ChainSignatureContract`, diverifikasi runtime + `.d.ts`).
  `Account` dibangun sebagai `new Account(accountId, provider, signer)`
  dengan `JsonRpcProvider` + `KeyPairSigner.fromSecretKey(...)`.
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

**DIBUAT Day-1 (2026-11-09 ~15:38 WIB): `mintguard.testnet`, public key
`ed25519:5tbjhcmhccmxL8KXkFFzeX34MkGaGfhBFYZWjbnqvyQU`, didanai 10 NEAR
via `POST helper.testnet.near.org/account` (keypair ed25519 digenerate
lokal).** Key hanya di `~/.near-credentials/testnet/mintguard.testnet.json`
(mode 600) + `.env.local` (gitignored). Alamat turunan
(`ethereum-1`): `0x225b2C6c45A3f4d5bEf62732CCf380F3dA644e1A` — terverifikasi
cocok antara rumus offline, view call `derived_public_key` on-chain, dan
`chainsig.getDerivedPublicKey`. Saldo NEAR pasca-validasi: 9,9983 NEAR.

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

1. **API `signerAccount` untuk agen CLI — TERSELESAIKAN Day-1 (2026-11-09).**
   Pola yang jalan: `Account` @near-js/accounts 2.5.1 +
   `signAndSendTransactions` native (lihat §5 catatan + `src/signing/mpc.ts`);
   `sign` live 3x sukses, latensi 12,88–16,91 dtk. Sisa catatan: latensi
   ~13–17 dtk per tanda tangan — demo harus menunjukkan progress, bukan
   mengasumsikan "1 detik trigger".
2. **Latensi `sign` MPC belum diukur.** Metode ini yield menunggu jaringan
   MPC; estimasi komunitas "beberapa detik", tapi belum ada angka testnet
   yang terukur dari kita. Kalau ternyata 30–60 detik per tanda tangan,
   demo tetap jalan (tunjukkan progress), tapi alur "1 detik trigger"
   ala free-mint BSC tidak berlaku di sini. Ukur Day 1.
3. **Faucet tBNB punya filter bot (≥0,002 BNB mainnet).** Bukan blocker
   keras — atasi dengan pola kirim dari wallet yang sudah ada (§7) — tapi
   harus disiapkan sebelum demo, bukan saat demo. **Update Day-1
   (2026-11-09): TIDAK ADA wallet Rakha yang lolos filter (baw 0,000847
   BNB); QuickNode kini ikut mensyaratkan saldo mainnet; Chainstack
   0,08 ETH. Jalur tanpa biaya yang tersisa: bot Telegram
   `@bnbchain_official_bot` / tiket Discord (0,3 tBNB/hari) — lihat §12.
   Layer A tertahan di blocker ini; Layer B sudah tercapai.
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

## 12. Log validasi Day-1 (Worker 1, 2026-11-09 ~15:38–16:00 WIB)

- **Deps ter-install (project, bukan global):** `chainsig.js@1.1.16`,
  `@near-js/*@2.5.1` (client, crypto, accounts, keystores, providers,
  signers, transactions, utils), `viem@2.57.17`; dev: `solc@0.8.30`,
  `@openzeppelin/contracts@5.4.0` (untuk kontrak demo NFT).
- **Modul jadi:** `src/signing/derive.ts` (refactor example-derive),
  `src/signing/mpc.ts` (ChainSignatureContract + signerAccount CLI +
  recovery offline), `src/signing/broadcast.ts` (finalize + broadcast,
  guard chainId 97, tolak 56), `src/signing/cli-sign.ts` (validasi Layer
  C), `src/signing/cli-mint.ts` (alur Layer A/B), `src/signing/nft-contract.ts`
  (compile `contracts/MintGuardDemoNFT.sol` — ERC721 free-mint minimal,
  4604 byte bytecode, ABI 29 item). `example-derive.ts` tetap jalan.
- **Derive — TERBUKTI 3 arah:** offline
  `0x225b2C6c45A3f4d5bEf62732CCf380F3dA644e1A` == view call
  `derived_public_key` on-chain == `chainsig.getDerivedPublicKey`.
  Kunci turunan:
  `secp256k1:NUbEKhQpvDSHBrhgv3Y5NLRuywZvSjFEj2eKNyStgjrHtg2NUa6jTcT3rPYEBii23vDRN2MErSBHdn6nqtJNGan`.
- **MPC `sign` live — JALAN, latensi 12,88 dtk & 16,91 dtk** (2x sign hash
  pesan) dan **15,31 dtk** (sign hash tx deploy). Recovery offline MATCH
  di semua run (`ethers.recoverAddress` == alamat turunan).
  **LAPISAN C TERCAPAI.**
- **Blokir teknis yang ditemukan & diatasi:** egress VM kadang menutup
  socket TLS di tengah request (`UND_ERR_SOCKET`, "other side closed")
  sehingga `sign` gagal 2x dengan `fetch failed` pada provider tunggal.
  Perbaikan: `FailoverRpcProvider` (4 RPC testnet NEAR) + fallback viem
  antar 4 RPC BSC. Setelah itu sign lolos.
- **Layer B — TERBUKTI:** tx deploy `MintGuardDemoNFT` disiapkan
  (EIP-1559, chainId 97, nonce 0, gasLimit 1.028.393, maxFeePerGas 0,1
  gwei) → MPC sign → recovery MATCH → `finalize` menghasilkan raw tx
  valid; `ethers.Transaction.from` mem-parse-nya dengan `from` == alamat
  turunan. Raw tx tersimpan di
  `src/signing/layer-b-signed-deploy-tx.txt`, hash bila di-broadcast:
  `0xe9f6cadc03f8175973d1c419e966ff3105e2bcfcf2eb5d5c23a21c076c50c627`.
- **Gas BSC testnet (cek live 3 RPC):** `eth_gasPrice` = 0,1 gwei.
  Deploy ≈ 0,000103 tBNB; mint ≈ 0,00001 tBNB. Drip 0,01 tBNB pun
  cukup untuk deploy + puluhan mint.
- **tBNB — BLOKIR UTAMA, belum ada (saldo alamat turunan 0):**
  - Faucet resmi: butuh ≥0,002 BNB mainnet di alamat peminta. Semua
    wallet Rakha di bawah itu: baw `0xC354...F021` = 0,000847 BNB
    (kurang ~0,001153 BNB), phone `0x4E05...00B2` = 0, TERA
    `0x8859...6647` = 0, vAPI `0x1188...67E6` = 0.
  - QuickNode faucet: halaman live 2026-11-09 menyatakan **sekarang juga
    mensyaratkan "a small mainnet balance"** — klaim "tanpa syarat" di
    blog-blog lama sudah basi. Terblokir.
  - Chainstack: butuh 0,08 ETH mainnet + API key. Terblokir.
  - Chainlink faucet: halaman JS-rendered, wajib connect wallet
    (MetaMask/WalletConnect) — tidak bisa headless; alamat turunan
    memang tidak punya key EVM (by design). Tidak dicoba lebih jauh.
  - thirdweb (`thirdweb.com/binance-testnet`, 0,01 tBNB/hari): wajib
    connect wallet + sign-in — tidak bisa headless. Sama.
  - Bitbond TokenTool: wajib connect wallet + profil — tidak bisa headless.
  - `faucet.zalalena.com/bsc`: pihak ketiga tak dikenal + captcha —
    tidak diverifikasi, tidak direkomendasikan.
  - **Jalur yang tersisa (butuh langkah manusia, tanpa biaya):** bot
    Telegram resmi BNB Chain `@bnbchain_official_bot` atau tiket
    Discord BNB Chain — docs resmi menyebut 0,3 tBNB/hari tanpa syarat
    saldo mainnet. Rakha cukup kirim alamat turunan ke bot.
  - **Jalur berbayar (butuh iya Rakha, ~$1,30):** top-up wallet baw
    ~0,0012 BNB mainnet → 0,002 BNB → faucet resmi terbuka (0,3 tBNB/hari).
    TIDAK dieksekusi — menunggu persetujuan eksplisit.
  - Simular Box TIDAK dipakai: halaman faucet yang tersisa semuanya
    berujung connect-wallet/captcha/langkah manusia — render JS tidak
    mengubah hasil itu.
- **Kesimpulan Day-1: LAPISAN B tercapai dengan bukti kriptografis
  lengkap; Layer A tertahan SATU blocker (tBNB 0).** Begitu alamat
  turunan menerima tBNB (jalur bot Telegram atau top-up), jalankan
  `npx tsx src/signing/cli-mint.ts` — deploy + mint + verifikasi
  `ownerOf` sudah siap, tanpa perubahan kode.
