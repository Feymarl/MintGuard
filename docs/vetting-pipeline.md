# MintGuard — Vetting Pipeline (Step 1: VET)

> Modul ini memverifikasi kontrak free-mint BSC **sebelum** mint apa pun:
> Sourcify → baca kuota on-chain → simulasi `eth_call` → cek keamanan
> token → satu JSON verdict. **Read-only**: tidak pernah mengirim transaksi,
> tidak pernah memanggil `execute`/`approve`/`transfer`.

## Arsitektur: Core (chain-agnostic) vs Adapter (per-chain)

Sesuai strategi multi-hackathon (satu core modular, adaptasi per hackathon),
modul ini dipisah dua lapis. Core tidak tahu apa itu BSC; adapter BSC
menyuntikkan semua pengetahuan chain-spesifik. Menambah chain baru
(X Layer, Arbitrum, …) = satu file adapter baru, **tanpa mengubah core**.

```
src/vetting/
├── core/                     # CHAIN-AGNOSTIC — dipakai semua hackathon
│   ├── types.ts              #   Verdict, Risk, ChainAdapter interface
│   ├── selectors.ts          #   selector = keccak256(signature), EIP-1967 slot
│   ├── scoring.ts            #   scoring murni 0-100 + verdict (offline-testable)
│   ├── simulate.ts           #   simulasi eth_call mint (from + value 0)
│   ├── safety.ts             #   parsing GoPlus + heuristik hidden-fee
│   └── engine.ts             #   orkestrasi: Sourcify + reads + sim + safety
├── adapters/
│   └── bsc.ts                #   ADAPTER BSC: RPC BSC, Sourcify 56, GoPlus 56
├── sourcify.ts               #   klien Sourcify v2 (chainId sebagai parameter)
├── rpc.ts                    #   provider ethers v6 (selalu kirim browser UA)
├── verdict.ts                #   vetContract(address, { chain, walletAddress })
└── cli.ts                    #   npm run vet
```

### Core — `src/vetting/core/`

| File | Isi |
| --- | --- |
| `types.ts` | `VettingVerdict`, `Risk`, `ChainAdapter` — kontrak interface antara core dan adapter. |
| `selectors.ts` | `selector(sig)` = 4 byte pertama `keccak256(sig)`. Selector **tidak pernah** ditulis tangan (pelajaran dari bug selector `totalMinted` yang salah). `isMintCandidate()` membedakan fungsi mint asli dari admin/getter (`setMintOpen`, `freeClaimed`, `mintPrice`). |
| `scoring.ts` | Logika verdict murni (tanpa network): `scoreVetting()` + `deriveFreeQuota()` + `buildVerdict()`. |
| `simulate.ts` | `simulateMintAt(provider, contract, abi, wallet)`: cari kandidat mint/claim di ABI (non-view), bangun calldata dari ABI, `eth_call` dengan `from=<wallet>`, `value=0`. Coba semua kandidat sampai satu sukses. |
| `safety.ts` | `parseGoPlusResponse()` (honeypot/tax/owner) + `detectHiddenFee()`. |
| `engine.ts` | `vetContractWithAdapter(adapter, address, deps, wallet?)`: Sourcify → snapshot on-chain → GoPlus → simulasi → `buildVerdict()`. Juga `readUint/readBool/readAddress` generik via selector terhitung. |

### Adapter — `src/vetting/adapters/bsc.ts`

Satu-satunya tempat yang tahu soal BSC:

- `chainId: 56`, `sourcifyChainId: 56`, `goplusChainId: 56`
- RPC: `bsc-dataseed1/2.bnbchain.org`, `bsc-dataseed1.defibit.io` (dicoba berurutan sampai ada yang menjawab)
- `getTokenSecurity`: GoPlus `token_security/56` (gratis, tanpa key)

### Aturan keras yang diimplementasikan

1. **Sourcify pakai alamat lowercase.** Mixed-case EIP-55 membuat Sourcify
   menjawab "Invalid address" — `sourcify.ts` selalu me-lowercase dulu.
2. **BSC dataseed menolak request tanpa browser User-Agent.** `rpc.ts`
   memakai `ethers.FetchRequest` + header Chrome UA di semua request.
3. **`totalSupply()` BUKAN sisa mint** (pelajaran Chip404 2026-11-08:
   totalSupply 2.855/3.000 tampak "sisa 145" padahal `totalMinted()` sudah
   3.000 = sold out). Kuota hanya dari `totalMinted()` /
   `remaining()` / `maxSupply()` — lihat `deriveFreeQuota()`.
4. **Selector dihitung, bukan ditebak.** `totalMinted()` terhitung
   `0xa2309ff8` (di-assert di test); `0x817b1cd2` yang salah tidak muncul
   di mana pun.
5. **Simulasi hanya `eth_call`.** Tidak ada transaksi, tidak ada signing.

## Cara menjalankan

```bash
npm install
npm run vet -- --ca <alamat-kontrak> [--wallet <alamat>] [--chain bsc]
npm test        # vitest: 27 test (offline + live)
npm run build   # tsc -> dist/
```

`--chain` default `bsc`. Chain lain belum ada adapter-nya — CLI akan
menolak dengan daftar chain yang tersedia.

## Skoring & verdict

Mulai dari 100. Aturan hard-block (verdict `BLOCK`, skor dicap ≤ 19):

| Kondisi | Efek |
| --- | --- |
| Tidak ada code / bukan kontrak mint (tanpa fungsi mint/claim) | `NOT_MINT`, skor 0 |
| Source tidak terverifikasi di Sourcify | `BLOCK` |
| Kontrak `paused` | `BLOCK` |
| Honeypot (GoPlus) | `BLOCK` |
| Tax beli/jual > 10% | `BLOCK` |

Pengurang lain: mint berbayar (`mintPrice > 0`) −25, simulasi revert −30,
kuota habis −40, partial Sourcify match −10, proxy EIP-1967 −5, tax 6–10% −25,
owner belum renounced −5. Skor ≥ 80 → `SAFE`, sisanya → `RISKY`
(kecuali hard-block).

## Contoh output — GLOOP (live, 2026-11-09)

```bash
npm run vet -- --ca 0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE \
  --wallet 0xC35438581552BDe41e705ec301eeB17F13DDF021
```

```json
{
  "contract": "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE",
  "chain": "bsc",
  "chainId": 56,
  "verified": true,
  "exactMatch": true,
  "isProxy": false,
  "implementation": null,
  "mintPriceWei": null,
  "freeQuotaRemaining": null,
  "totalMinted": 3333,
  "maxSupply": null,
  "simulationOk": false,
  "simulationError": "already minted",
  "simulatedFunction": "mint(uint256)",
  "risks": [
    {
      "code": "simulation_revert",
      "message": "eth_call simulation of function mint(uint256) reverted: already minted. Mint may be gated (PoW, allowlist, window) or closed.",
      "severity": "warn"
    }
  ],
  "score": 70,
  "verdict": "RISKY"
}
```

Catatan: `simulationError: "already minted"` adalah sinyal per-wallet yang
benar — wallet ini sudah mint GLOOP #3096, jadi simulasi mint ulang revert.
Verdict `RISKY` (bukan `BLOCK`): kontraknya verified + bersih, hanya mint
dari wallet ini yang sudah tidak bisa.

## Hasil live lain (2026-11-09, dicatat dari `npm test` + CLI)

| Kontrak | Verified | Verdict | Skor | Keterangan |
| --- | --- | --- | --- | --- |
| GLOOP `0x183C…4fE` | ✅ exact | RISKY | 70 | Simulasi revert "already minted" (wallet sudah mint) |
| Mechfarm `0x1fab…367` | ✅ exact | RISKY | 70 | `mint(uint256)` revert custom error `0x888e58a8` bahkan dari wallet fresh — mint window kemungkinan sudah tutup |
| Minority Pass `0xc4ad…9fa` | ✅ exact | RISKY | 45 | Free lane sold out (`totalMinted` 200); `mintPrice` terbaca 0.003 BNB (paid lane) |
| WBNB `0xbb4C…95c` | ❌ (tidak ada di Sourcify) | NOT_MINT | 0 | Bukan kontrak mint — dikenali, bukan SAFE |

## Batasan yang diketahui

1. **Kuota `null` bila kontrak tidak punya counter standar.** GLOOP dan
   Mechfarm tidak mengekspos `maxSupply()`/`remaining()` (GLOOP hanya
   `totalMinted()`; Mechfarm tidak satu pun) — `freeQuotaRemaining` jadi
   `null` (artinya "tidak diketahui", bukan 0). Jangan artikan `null`
   sebagai "stok tak terbatas".
2. **Harga `null` bila tidak ada price getter.** Mechfarm tidak punya
   `mintPrice()`/`price()`/`cost()` — `mintPriceWei: null`. Gratis/tidaknya
   hanya bisa dibuktikan lewat simulasi value-0 yang sukses.
3. **Kontrak dua jalur (free + paid).** Minority Pass: `price()` mengembalikan
   harga jalur berbayar (0.003 BNB) sementara jalur gratisnya `claimFree()`.
   Risiko `paid_mint` bisa muncul pada kontrak yang sebenarnya punya jalur
   gratis — baca `simulatedFunction` untuk melihat jalur mana yang disimulasi.
4. **Simulasi pakai argumen placeholder** (address → wallet, quantity → 1,
   sisanya 0). Mint yang butuh PoW nonce / allowlist proof / merkle proof
   akan revert di simulasi — itu dicatat sebagai `simulation_revert`
   (RISKY), bukan BLOCK. Engine belum bisa membedakan "gated" dari "tutup".
5. **GoPlus sering kosong untuk NFT.** Banyak kontrak NFT tidak punya baris
   GoPlus — `tokenSecurity: null` berarti "tidak ada data", bukan "aman".
   Heuristik on-chain (verified/paused/harga) tetap jalan.
6. **Simulasi mencoba kandidat sesuai urutan ABI** dan mengembalikan sukses
   pertama / error terakhir. Bila sebuah kontrak punya beberapa fungsi mint,
   fungsi yang pertama sukses-lah yang dilaporkan.
7. **WBNB tidak terverifikasi di Sourcify** (hanya di BscScan). Verdict
   `NOT_MINT`-nya di sini didorong oleh ABI kosong; deteksi `not_mint`
   dengan ABI yang ada diuji offline di `tests/vetting.test.ts`.
8. **Proxy:** implementasi EIP-1967 dibaca dari storage slot, tapi source
   implementasi belum ikut di-verify ulang — risiko `proxy` dicatat sebagai
   peringatan.

## Catatan struktur vs `docs/architecture.md`

`architecture.md` (milik koordinator) masih menggambarkan `src/vetting/`
flat (`sourcify.ts`, `rpc.ts`, … di root). Modul ini mengikuti instruksi
update 2026-11-09 ~15:22 WIB: `src/vetting/core/` (engine generik) +
`src/vetting/adapters/bsc.ts` (adapter pertama). Fungsionalitasnya sama;
bila koordinator menyeragamkan layout repo, pindahkan file-file ini
(mis. ke `src/core/vetting/` + `src/adapters/bsc/`) tanpa mengubah isi —
core tidak mengimpor apa pun dari luar `src/vetting/`.
