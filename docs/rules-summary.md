# NEAR HACKATHON 2026 — Official Rules Summary

Verified from the official sources on 2026-11-09 (WIB):
- https://www.near.org/blog/near-hackathon-build-beyond-boundaries
- https://nearhackathon.com (homepage + FAQ)
- https://nearhackathon.com/HACKATHON.md (live, read again before submitting — dates/rules may change)

## Facts

| Fact | Value |
| --- | --- |
| Event | NEAR HACKATHON: Build Beyond Boundaries |
| Build window | 2026-11-01 00:00 UTC → **2026-11-14 23:59 UTC** (= 15 Nov 06:59 WIB) |
| Judging | 2026-11-16 → 2026-11-18 |
| Results by | 2026-11-18 23:59 UTC |
| Entry cost | **FREE — no fee, no stake, no sign-up** |
| Prize pool | **$250,000 paid in NEAR**: Grand $55,000 ×1; per track (13 tracks) 1st $10,000, 2nd $3,000, 3rd $2,000 |
| Payout | Single payment, no vesting, within 30 days of results |
| Submission | Public GitHub repo + public demo post on X (video/screenshots, tag @NEARProtocol + #NEARHackathon) + form/API |
| Submission API | `POST https://nearhackathon.com/api/applications` (body ≤ 12000 bytes) |
| Request changes | https://nearhackathon.com/request-changes (never submit twice; same repo = 409) |

## What the submission needs (human decides — never guess)

- projectName (2–80 chars), leadName (2–80), email (≤160 chars; max 2 submissions per email)
- size: `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+`
- tracks: one or more ids: `defi`, `thesis`, `privacy`, `business`, `swarms`, `security`, `agents`, `realworld`, `games`, `nfts`, `memecoins`, `social`, `open`
- nearAddress: mainnet NEAR account for payout (named like `team.near` or 64-char implicit). The team creates it in a NEAR wallet — **never create/invent one on their behalf**.
- projectUrl (public repo, unique), demoUrl (public X post), idea (20–2000 chars)
- consent: `true` only after the human agrees verbatim: "I agree that the organizers may use these details to review our submission and contact us about this hackathon."
- `requestId`: UUID generated once, reused on retries. Do NOT add other fields — `website` is a spam trap (non-empty = rejected).

## Rules that shape our build (from HACKATHON.md Q&A)

- **Q-001/Q-002**: Code written since the 2026-10-19 announcement counts. Existing product on another chain is ALLOWED — only the NEAR integration built in the window is judged. **Disclose in README.**
- **Q-003**: New repo not required (branch/tags + README diff link also OK). We use a fresh repo.
- **Q-005**: Libraries, templates, boilerplate, own pre-hackathon libs, AI-written code all allowed. List in README; own old libs count as baseline.
- **Q-008**: Testnet NEAR is free (near-cli faucet, near-faucet.io). Mainnet costs not reimbursed.
- **Q-010**: Testnet-only projects are eligible in all tracks.
- **Q-011**: No mandatory integrations. Own NEAR contract that fits the track is enough.
- **Q-012**: Local-only demo OK (public repo + reproducible README + X video). Screenshots alone are NOT enough when judges cannot open the demo. Hosted demo is a plus; keep it up to 2026-11-18, ideally 2026-11-25.
- **Q-014**: Any license; MIT is fine. Repo stays public through judging.
- **Q-015**: One person, max 2 different independent projects, each README names the other.
- **Q-017**: Claude Code & Codex SCREEN every project first (reproducibility check, feature verification, structured report, preliminary score). Humans decide; low AI score alone cannot reject.
- **Judging (past hackathons)**: technical implementation, design, impact, originality, sustainability.
- **README must be written for a machine reader too**: what the product is, the problem, and "do X — see Y" steps a judge can follow. No marketing.
- **Demo post**: lead with the user problem, show ONE complete moment (real action → visible result), explain NEAR's role concretely (not vague "powered by NEAR"), give a next step (link demo + repo, ask a genuine question).
- **Never without human confirmation**: send the submission (print full JSON payload first, wait for yes), post on X on their behalf, make the repo public / push, sign txs / spend tokens / deploy to mainnet, commit secrets.

## Our tracks

- **Primary: `agents` (Agent Economy)** — "Give AI a wallet": agents that earn, spend, negotiate, hire other agents and pay for APIs/compute/data — with crypto directly or through NEAR Intents. Hints: agent commerce, NEAR Intents, Chain Signatures.
- **Also fits: `security` (AI Security & Defense)** — spending limits, policy engines, sandboxed wallets, reputation, scam detection. Hints: agent security, function call keys, TEE attestation.
- **Also fits: `open` (Open Innovation)** — ideas that refuse a category.

## Judges

Illia Polosukhin (NEAR), Eddy Lazzarin (a16z crypto), Mert Mumtaz (Helius), Avichal Garg (Electric Capital), Kain Warwick (Synthetix/Infinex), Haseeb Qureshi (Dragonfly), Stepan Gershuni (cyber•Fund), plus Claude Code & Codex (Anthropic & OpenAI) as AI screeners.
