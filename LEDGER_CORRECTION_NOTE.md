# Ledger Correction Note — reputation ledger is now ON-CHAIN

Branch: `near-ledger` (off `master` @ `0e606a7`, the submitted snapshot).
Date: 10 Nov 2026. Status: built + deployed + verified on NEAR testnet.
**This note was NOT filed anywhere — filing a correction is Rakha's
decision (see "How to file" below).**

## What changed vs the submission

At submission time (9 Nov 2026, HTTP 201, requestId
`11429113-f9c2-4fc2-a3a7-4d295ff2f26d`) the reputation ledger was a
**local JSONL file** (`data/ledger.jsonl`), with the on-chain NEAR
contract described in the README as a stretch goal. The submitted `idea`
text says:

> "Every vetting and mint is recorded in the agent's reputation ledger."

That sentence is still accurate — but the ledger is now a **real on-chain
NEAR contract**, not a local file. This note documents the change so a
correction can be filed with the organisers before judging (16–18 Nov).

## The on-chain ledger

- **Contract:** `mintguard.testnet` (NEAR testnet — the agent's own account)
- **Explorer:** https://testnet.nearblocks.io/accounts/mintguard.testnet
- **Code:** `contracts/reputation-ledger/` (Rust, `near-sdk` 5.30.1,
  `cargo near` 0.23.0 build; wasm 224,038 bytes)
- **Methods:** `record_verdict` (change) + `get_verdict` /
  `list_verdicts` / `verdict_count` (view). Append-only: history is never
  edited or deleted; a later verdict for the same contract supersedes the
  earlier one for `get_verdict`.
- **Client:** `src/reputation/onchain-ledger.ts` (uses the project's
  existing @near-js patterns from `src/signing/mpc.ts` — no new key
  handling). Deploy: `npx tsx scripts/deploy-ledger.ts`. Vet + record:
  `npx tsx scripts/record-verdict.ts --ca <0x...>`. Read-only check:
  `npx tsx scripts/check-ledger.ts`.
- **Cost (measured):** deploy + init + 2 records ≈ **0.0022 NEAR total**
  (balance 9.988 → 9.986 NEAR). Testnet only; no mainnet, no paid services.

## Proof (all verified on-chain, 10 Nov 2026)

| Step | Tx / evidence |
|---|---|
| Deploy contract code | `E4KpfVbzfnCSmnWN74j6mwzjuPA5YBGi4HXvDrhUGVSa` — https://testnet.nearblocks.io/txns/E4KpfVbzfnCSmnWN74j6mwzjuPA5YBGi4HXvDrhUGVSa |
| Init state (`new`) | `DjgByetWCGxU5BtfRLz9XaatSnRr8rrFQr6CTFQfKMBZ` — https://testnet.nearblocks.io/txns/DjgByetWCGxU5BtfRLz9XaatSnRr8rrFQr6CTFQfKMBZ |
| Record #1 (GLOOP → RISKY 70, generic reason) | `3TJyNP5TEgjTAyqCYzhcou6x1n3gYqzwLZjwSf78EB2U` — https://testnet.nearblocks.io/txns/3TJyNP5TEgjTAyqCYzhcou6x1n3gYqzwLZjwSf78EB2U |
| Record #2 (GLOOP → RISKY 70, engine's real reason) | `G2maiiR7fDfKKLfvdBpohphUJcrbaPNJkA1rprzhFuGS` — https://testnet.nearblocks.io/txns/G2maiiR7fDfKKLfvdBpohphUJcrbaPNJkA1rprzhFuGS |
| Read-back (`get_verdict` + `list_verdicts`) | `verdict_count: 2`; latest entry: `{"contract":"0x183cbb52b3c7bcb2433d50de0add99b59f4de4fe","verdict":"RISKY","score":70,"reason":"sim reverted: Agent ID required","chain":"bsc","agent":"mintguard.testnet","recorded_at_ns":1794254605449712400}` |

The verdict recorded is exactly the verdict the live engine returned for
GLOOP `0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE` on 10 Nov 2026
(`npm run vet` → RISKY 70, simulation reverted "Agent ID required").
Record #1 used a generic reason string ("vetting completed") because the
first version of the wiring script did not extract the engine's reason;
record #2 supersedes it with the engine's real reason. Both entries stay
in the append-only history — that is the ledger working as designed.

Unit tests: `cargo test` in `contracts/reputation-ledger/` — 3 passed
(record/read-back, reject score > 100, reject bad verdict). TypeScript:
`npx tsc --noEmit` clean on the branch.

## What does NOT change

- The submitted payload (`idea` text, tracks, repo URL, demo URL,
  requestId) needs **no change** — the `idea` sentence about the ledger
  stays true; only the README's description of *where* the ledger lives
  changes (local file → on-chain contract).
- `master` was never touched. All of this work is on branch `near-ledger`
  only. The submitted repo snapshot on `master` is unchanged.
- The local `data/ledger.jsonl` file still exists as a local mirror; the
  on-chain contract is the source of truth.

## How to file the correction (Rakha's decision — do NOT file without him)

1. **Push the branch first** (it is local-only right now): the correction
   should link the branch so judges can read the new code. Push
   `near-ledger` to https://github.com/Feymarl/MintGuard (do NOT push to
   `master`, do NOT merge into `master` — master stays the frozen
   submitted snapshot through judging, 18 Nov).
2. Open https://nearhackathon.com/request-changes (the official
   corrections page — never re-submit; same repo = 409).
3. Identify the submission: project **MintGuard**, requestId
   `11429113-f9c2-4fc2-a3a7-4d295ff2f26d`, email
   `ferimarliadi9@gmail.com`.
4. State the change in one paragraph (copy/paste):
   > "Correction to the MintGuard submission: the agent reputation ledger
   > described in our README as a local file is now implemented as an
   > on-chain NEAR contract on testnet (`mintguard.testnet`,
   > https://testnet.nearblocks.io/accounts/mintguard.testnet). The
   > submitted `idea` text is unchanged — every vetting is still recorded
   > in the agent's reputation ledger; the ledger now lives on-chain.
   > Code and proof are on branch `near-ledger` (link). No other
   > submission field changes."
5. Attach/point to the evidence: the contract explorer link, the record
   tx `G2maiiR7fDfKKLfvdBpohphUJcrbaPNJkA1rprzhFuGS` (GLOOP → RISKY 70),
   and the `near-ledger` branch link.
6. File **before judging ends (18 Nov 2026)** — earlier is better; the
   correction only strengthens the submission, it does not replace it.
