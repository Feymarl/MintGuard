# MintGuard — Submission Checklist & Payload

> NEAR HACKATHON 2026: Build Beyond Boundaries.
> Deadline: **14 Nov 2026 23:59 UTC (= 15 Nov 06:59 WIB)**.
> Submit once, via `POST https://nearhackathon.com/api/applications`
> (body ≤ 12000 bytes) or the form. Source of truth for fields:
> `docs/rules-summary.md` (verified 9 Nov 2026 from near.org,
> nearhackathon.com, HACKATHON.md). **Re-read HACKATHON.md live before
> submitting — dates/rules may change.**

## ⛔ Hard warnings (read first)

1. **NEVER submit twice.** Same repo = **409**. If a correction is needed,
   use https://nearhackathon.com/request-changes — do not re-submit.
2. **NEVER fill the `website` field.** It is a spam trap: non-empty =
   rejected. The payload below does not contain it.
3. **`requestId` (UUID) is generated ONCE and reused on retries.** A new
   UUID per retry risks a duplicate submission.
4. **NEVER guess human fields.** `projectName`, `leadName`, `email`,
   `nearAddress` (mainnet payout account), `projectUrl` and `demoUrl`
   are decided by the human. Placeholders below are `[BRACKETS]` — a
   submission with a placeholder still in it must NOT be sent.
5. **Send only after the human confirms the full printed JSON payload.**
   Print it, wait for an explicit yes for that exact payload.
6. `nearAddress` is a **mainnet** NEAR account created by the human in a
   NEAR wallet (named like `team.near` or a 64-char implicit account).
   **Never create or invent one on the human's behalf.**
7. Body ≤ 12000 bytes. The draft `idea` below is 852 characters; the full
   payload must be measured before sending.

## Submission checklist

| # | Item | Status |
|---|---|---|
| 1 | Repo public on GitHub (stays public through judging, 18 Nov; ideally 25 Nov) | ⬜ human pushes / makes public |
| 2 | README: problem, “do X — see Y” reproduction steps, baseline disclosure (Q-002/Q-005), honest status | ✅ in repo (`README.md`) |
| 3 | Demo UI present (`demo/index.html`, static, verified rendering) | ✅ this repo |
| 4 | Demo video recorded per `docs/demo-script.md` | ⬜ record 12 Nov (planned) |
| 5 | Demo post published on X (video attached, tag + hashtag — see draft below) | ⬜ human posts 14 Nov |
| 6 | `demoUrl` = URL of that public X post | ⬜ fill after posting |
| 7 | `projectUrl` = public repo URL | ⬜ fill after repo is public |
| 8 | `projectName`, `leadName`, `email` decided by human | ⬜ human decides |
| 9 | `size` decided by human (`1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`) | ⬜ human decides |
| 10 | `tracks` confirmed: `agents`, `security`, `open` | ✅ decided (see payload) |
| 11 | `nearAddress` (mainnet payout account) created by human in wallet | ⬜ human creates |
| 12 | `idea` draft (852 chars, within 20–2000) reviewed by human | ✅ draft below; human reviews |
| 13 | Consent sentence agreed verbatim by human | ⬜ human agrees (see below) |
| 14 | `requestId` UUID generated once, stored for retries | ⬜ generate at submit time |
| 15 | Full JSON payload printed, human confirms, then ONE submit before 14 Nov 23:59 UTC | ⬜ submit day |

## Payload template (fill the [BRACKETS], then print + confirm)

```json
{
  "projectName": "[PROJECT_NAME — 2–80 chars, human decides]",
  "leadName": "[LEAD_NAME — 2–80 chars, human decides]",
  "email": "[EMAIL — max 160 chars, human decides; max 2 submissions per email]",
  "size": "[SIZE — one of: \"1\", \"2 - 4\", \"4 - 6\", \"6 - 8\", \"8+\", human decides]",
  "tracks": ["agents", "security", "open"],
  "nearAddress": "[NEAR_MAINNET_PAYOUT_ACCOUNT — created by the human in a NEAR wallet, e.g. team.near; NEVER invented]",
  "projectUrl": "[PUBLIC_REPO_URL — human fills after the repo is public]",
  "demoUrl": "[PUBLIC_X_POST_URL — human fills after posting the demo on X]",
  "idea": "MintGuard is an AI agent that only mints what it has verified. Today an agent asked to mint an NFT either holds a raw EVM private key — one leak drains the wallet — or blindly trusts whatever contract a link points to, and free-mint scams, honeypots and fake free mints that drain approvals are routine on BSC. MintGuard automates the human hunter's checklist: it vets any BSC free-mint contract (Sourcify verification, proxy detection, free-quota reads, eth_call simulation, honeypot and tax scan) into a scored verdict — SAFE, RISKY, BLOCK or NOT_MINT — and only on a clean verdict executes the mint cross-chain from a NEAR account via NEAR Chain Signatures, so no seed or private key ever exists on the agent's machine. Every vetting and mint is recorded in the agent's reputation ledger. Built for the agents track: give AI a wallet it cannot leak.",
  "consent": true,
  "requestId": "[UUID — generate once with e.g. `python3 -c 'import uuid; print(uuid.uuid4())'`, reuse on retries]"
}
```

Notes on the template:

- `idea` is **852 characters** (limit 20–2000). Count again after any edit:
  `python3 -c "print(len(open('idea.txt').read()))"`.
- `consent: true` ONLY after the human agrees to the verbatim sentence:
  > “I agree that the organizers may use these details to review our
  > submission and contact us about this hackathon.”
  Until then, keep it `false` / unset and do not submit.
- `tracks`: primary `agents` (Agent Economy); also `security` (AI Security &
  Defense) and `open` (Open Innovation) — per `docs/rules-summary.md`.
- Do NOT add any other field. In particular, do NOT add `website`.
- Keep the whole body ≤ 12000 bytes. Measure with
  `python3 -c "import json; print(len(json.dumps(payload).encode()))"`.

## Demo post on X — draft

Post in English, video attached (per `docs/demo-script.md`). Requirements
met: opens with the user problem, shows ONE complete moment (vet GLOOP →
RISKY 70, sim reverted “already minted”), NEAR’s role is concrete (MPC
signs; no key on the machine), next step is repo + demo links, ends with a
genuine question, tags `@NEARProtocol` + `#NEARHackathon`.

### Variant A — use if a hosted demo URL exists (275 chars with real links)

> Agents minting NFTs hold a raw key or trust blind. MintGuard vets — GLOOP
> 70/RISKY, sim reverted 'already minted' — then NEAR MPC signs, no key
> onboard. Repo: [REPO_URL] Demo: [DEMO_URL] What would you let an agent
> mint? @NEARProtocol #NEARHackathon

Character count: 249 with `[REPO_URL]` / `[DEMO_URL]` placeholders;
**275** with real URLs (X shortens each URL to 23 chars via t.co).
5 characters of headroom — re-count in the X composer after pasting the
real URLs; if it overflows, drop to Variant B.

### Variant B — use if there is no hosted demo URL (274 chars with real link)

The post itself carries the video, so it *is* the demo; only the repo link
is in the text.

> Agents minting NFTs hold a raw key or trust blind. MintGuard vets first:
> GLOOP 70/RISKY, sim reverted 'already minted'. Then NEAR Chain Signatures
> MPC signs, no key on the machine. Repo: [REPO_URL] What would you let an
> agent mint? @NEARProtocol #NEARHackathon

Character count: 261 with the `[REPO_URL]` placeholder; **274** with a real
URL (23 chars via t.co).

### Posting notes

- The human posts (never post on their behalf without explicit confirmation).
- Attach the video from `docs/demo-script.md`; do not post screenshots alone
  (Q-012: screenshots are not enough when judges cannot open the demo).
- After posting, copy the post URL into `demoUrl` in the payload above.
- Keep the demo UI hosted / the repo public until at least 18 Nov 2026
  (ideally 25 Nov).

## Timeline to deadline

| Date | Action |
|---|---|
| 10–11 Nov | Live MPC `sign` + BSC-testnet broadcast (Day-1 validation); reputation ledger; insert Scene 3B into the video if it lands |
| 12 Nov | Record demo video per `docs/demo-script.md` |
| 13 Nov | Dry-run of the whole judge path from a clean checkout; repo public (human pushes); final payload review |
| 14 Nov | Human posts demo on X → fill `demoUrl` → print full JSON → human confirms → submit ONCE before 23:59 UTC |
| 16–18 Nov | Judging; results by 18 Nov 23:59 UTC |

## Post-submission correction (10 Nov 2026 — branch `near-ledger`, NOT filed)

The reputation ledger is now an **on-chain NEAR contract**
(`mintguard.testnet` on testnet) instead of the local `data/ledger.jsonl`
file described at submission time. The submitted `idea` text needs no
change ("Every vetting and mint is recorded in the agent's reputation
ledger" — still true). Proof: GLOOP → RISKY 70 recorded on-chain (tx
`G2maiiR7fDfKKLfvdBpohphUJcrbaPNJkA1rprzhFuGS`). Full details + how to
file the correction at https://nearhackathon.com/request-changes:
`LEDGER_CORRECTION_NOTE.md`. **Do NOT file without Rakha's explicit
go-ahead, and never re-submit (same repo = 409).**
