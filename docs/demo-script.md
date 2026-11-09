# MintGuard — Demo Video Script (~2–3 minutes)

> Purpose: the recording script for the X demo post (video). The final video
> is assembled later by the parent — this file is the script + the verified
> assets, not an MP4. Every command and output below was run live on
> 9 Nov 2026; re-run them during recording (do not fake the terminal with
> stills). If the live MPC `sign` + BSC-testnet mint lands before recording
> day, insert Scene 3B and re-time.

## Target

- Length: **~2:45** (hard cap 3:00 — X video in a demo post should stay short).
- Format: 1920×1080 screen capture, terminal font ≥ 16pt, browser at 100% zoom.
- Language: narration in English (the post is in English); on-screen text is
  already English.
- One complete moment (per the rules): a real vetting action → a visible
  verdict on screen. No staged “mint succeeded” frame until a real one exists.

## Setup before recording

1. Clean checkout, `npm install` done, terminal open in the repo root.
2. Browser open at `demo/index.html` (served locally, e.g.
   `python3 -m http.server` in `demo/`, or open the file directly).
   The page is static — no backend, no network calls.
3. Close notifications / other windows. Terminal: dark background, light text.
4. Do a dry run of Scenes 1–3 once (commands below) so the live RPC latency
   (~2–5 s per `vet`) is expected, not a surprise on camera.

## Scene 0 — Cold open (0:00–0:15) · The problem

**On screen:** `demo/index.html` header (“MintGuard — an AI agent that only
mints what it has verified”).

**Narration:**
> “An AI agent asked to mint an NFT today has two bad options: hold a raw
> private key — one leak and the wallet is drained — or blindly trust
> whatever contract a post links to. MintGuard is the third option: an agent
> that only mints what it has verified.”

**Action:** slow scroll from the header through the 3-step cards
(VET → SIGN → RECORD). Pause on the honest-status box.

## Scene 1 — VET, live (0:15–1:05) · The one complete moment

**On screen:** terminal in the repo root.

**Exact command:**
```sh
npm run vet -- --ca 0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE --wallet 0xC35438581552BDe41e705ec301eeB17F13DDF021
```

**Expected output (captured 9 Nov 2026, 08:37 UTC):**
```json
{
  "contract": "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE",
  "chain": "bsc",
  "chainId": 56,
  "verified": true,
  "exactMatch": true,
  "isProxy": false,
  "totalMinted": 3333,
  "simulationOk": false,
  "simulationError": "already minted",
  "simulatedFunction": "mint(uint256)",
  "score": 70,
  "verdict": "RISKY"
}
```
(Fields `mintPriceWei`, `freeQuotaRemaining`, `maxSupply` are `null` —
unknown, not zero. Full JSON is embedded in `demo/index.html`.)

**Narration:**
> “Here is the vetting, live. GLOOP on BSC — a real free mint. The contract
> is verified, exact match, not a proxy. But this wallet already minted
> number 3096, so the simulation correctly reverts with ‘already minted’,
> and the verdict is RISKY, score 70 — not SAFE. A clean mint needs 80 or
> more with a passing simulation. The agent stops here; a human reviews.”

**Action:** highlight `verified: true`, `simulationError: "already minted"`,
`score: 70`, `verdict: "RISKY"` as you speak. Do not edit the JSON.

## Scene 2 — Negative control (1:05–1:25) · It also says no

**On screen:** terminal.

**Exact command:**
```sh
npm run vet -- --ca 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
```

**Expected output:**
```json
{
  "contract": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "verified": false,
  "simulationError": "no mint/claim function in ABI",
  "score": 0,
  "verdict": "NOT_MINT"
}
```

**Narration:**
> “And it knows what is not a mint at all. WBNB: no mint function in the
> ABI — verdict NOT_MINT, score zero. The agent does not guess.”

## Scene 3 — SIGN: the address comes from NEAR, not from a key (1:25–1:55)

**On screen:** terminal.

**Exact command:**
```sh
npm run derive
```

**Expected output (captured 9 Nov 2026):**
```
NEAR account : example.testnet
Network      : testnet (MPC: v1.signer-prod.testnet)
Path         : ethereum-1
MPC root key : secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3
Derived key  : secp256k1:mtY14KMe3TZggrVhPwjM1Z68WKTXDMYNwNjyMTGzioKV3qJhFZ4LZ41KCe5RUNCjC3EGjS5wpZdzGJ5JZ1Dhab5
EVM address  : 0xD8ebbAA4f6558cc6b322987194Fd663a976272bD
(offline — tanpa key, tanpa network)
Self-check   : derived key OK, EVM address OK
```

**Narration:**
> “Signing is where NEAR comes in. This EVM address is derived from a NEAR
> account — example.testnet, path ethereum-1 — by NEAR Chain Signatures.
> The derivation runs offline, no key, no network, and the self-check passes
> against the MPC contract’s own public key. When the agent signs, NEAR’s
> MPC network produces the signature; no seed ever lives on the agent’s
> machine.”

**Honest line (say it on camera, do not skip):**
> “One caveat, stated plainly: this replaces a single key with a threshold
> assumption — security holds while fewer than the MPC threshold of
> participants are compromised. That is the trade-off, and it is in the
> README.”

### Scene 3B — Live MPC sign + BSC-testnet mint (ONLY if built before recording)

Insert here if the Day-1 validation has landed. Commands and expected
output must be filled in from a real run at that time — never stage them.
Suggested narration: “And here is the signature, live from the testnet MPC
contract, and the mint landing on BSC testnet — transaction hash on screen.”
If 3B is not ready, the video ends at Scene 4 with the derivation as the
NEAR proof, and the README states the live-sign status honestly.

## Scene 4 — The demo page: vet any contract (1:55–2:25)

**On screen:** `demo/index.html`, scrolled to “Try it yourself”.

**Action:**
1. Paste `0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE` into the contract field.
2. Click “Show me the command” — the exact CLI command appears with a copy
   button.
3. Scroll to the verdict table; point at SAFE / RISKY / BLOCK / NOT_MINT.

**Narration:**
> “The demo page does not fake a verdict — there is no live backend. You
> paste a contract, it shows the exact command to run in your terminal, and
> it tells you what each verdict means. Run it yourself; the repo is public.”

## Scene 5 — Close (2:25–2:45)

**On screen:** `demo/index.html` “Reproduce it” section (the do-X-see-Y
commands), then the repo README.

**Narration:**
> “MintGuard: vet first, sign with NEAR Chain Signatures, record everything.
> The code, the tests and the docs are in the repo — link in the post. One
> question for you: what mint would you trust an agent with?”

**End card (static, 3 s):** repo URL + “NEAR Hackathon 2026 — tracks:
agents · security · open”.

## Asset checklist

| Asset | Source | Status |
|---|---|---|
| Terminal capture: `vet` GLOOP with wallet → RISKY 70 | `npm run vet -- --ca 0x183C… --wallet 0xC354…` | ✅ captured 9 Nov 2026 08:37 UTC; embedded in `demo/index.html` |
| Terminal capture: `vet` GLOOP default (no wallet) → RISKY 70, unknown custom error | same command without `--wallet` | ✅ captured same time |
| Terminal capture: `vet` WBNB → NOT_MINT 0 | `npm run vet -- --ca 0xbb4C…` | ✅ captured same time |
| Terminal capture: `derive` → `0xD8eb…72bD`, self-check OK | `npm run derive` | ✅ captured same time |
| Screenshot: `demo/index.html` rendered (desktop Chrome) | Simular Box, real Chrome | ✅ 9 Nov 2026 — `demo/screenshot-chrome-2026-11-09.jpg` (1024×640; header + 3-step cards render correctly) |
| Screenshot: demo form with a pasted address + generated command | same session | ⬜ take while recording Scene 4 |
| Video: screen recording, scenes 0–5 | record on the day | ⬜ not yet recorded |
| Scene 3B assets (live MPC sign + testnet mint) | only if built | ⬜ pending build |

## Rules for the recording

- Re-run every command live on camera. Never paste a pre-made screenshot
  into the terminal portion.
- If a live RPC call is slow or fails during the take, keep the take and say
  so — or re-take. Never edit the JSON output.
- Do not show any private key, seed, `.env` content, or wallet with real
  funds. The derive example uses the public `example.testnet` account only.
- The video is the demo post’s attachment; the post text is drafted in
  `docs/submission.md`.
