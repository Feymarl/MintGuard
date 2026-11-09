# Multi-Hackathon Strategy — One Core, Many Adapters

Update 2026-11-09 ~15:22 WIB (Rakha: "kerjain aja semua yg ada").
Principle: **ONE modular MintGuard core, adapted per hackathon — never 5
separate projects from scratch.** NEAR stays the priority until its MVP is
done; December/February targets must never jeopardise the NEAR deadline.

## Target list (verified 2026-11-09)

| # | Hackathon | Deadline | Prize | Free entry? | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | NEAR Hackathon 2026 — Build Beyond Boundaries | **14 Nov 2026 23:59 UTC** | $250,000 in NEAR | ✅ FREE — verified from near.org + HACKATHON.md (no fee/stake/sign-up) | **PRIORITY — building now** |
| 2 | Arbitrum Open House Dubai — Online Buildathon (HackQuest) | 6 Dec 2026 | $30,000 | ✅ FREE — HackQuest page: "No barriers. No limits." No fee/stake/deposit anywhere on the official page | Adapter after NEAR MVP |
| 3 | X Layer TapeOut Accelerate 2026 (OKX Build X) | 7 Dec 2026 23:59 UTC | 100,000 USDT | ✅ FREE — official OKX page, submit via Google Form, no fee mentioned | Adapter after NEAR MVP |
| 4 | HackerNoon Decentralize AI Hackathon | 27 Feb 2027 (Round 2: Nov 2026–Feb 2027) | $51,750+ | ✅ FREE — official page states "Free Entry: 0 USD" | Write-up adapter, low effort |
| 5 | Arbitrum Open House São Paulo — Online Buildathon 2027 (HackQuest) | 1 Mar 2027 (submit by 28 Feb 2027 23:59 BRT) | $115,000 in USDG | ✅ FREE — official T&Cs (openhouse.arbitrum.io): registration form only, no fee | Adapter in Feb 2027 |

Total addressable: **$546,750+** (HackerNoon is mostly credits — see caveats).

### Skipped (per parent order)
- BCH BLAZE ($8,000 — wrong chain + small prize), Celo Agents ($5,000 — closed 9 Nov), Dev3pack (students only).

### Backlog — VERIFIED DEAD, removed 2026-11-09
- **XRPL AI & Fintech Hackathon NYC**: actually ran **24–25 Oct 2026, in person in
  New York** (Luma page + HackerNoon report). DevGrantsDaily still lists it as
  "open / no deadline" — that listing is stale. CLOSED, and in-person anyway.
- **HackMeridian 2026 (Stellar, Lisbon)**: ran **25–26 Oct 2026, in person only**,
  registration closed, no remote track. CLOSED.

## Per-target caveats (found during verification)

- **Arbitrum Dubai**: the Dubai Open House was POSTPONED in April 2026 (regional
  security situation) and rescheduled toward end of year. Listings say
  registration opened 31 Oct, submissions close 6 Dec — re-verify the date on
  the HackQuest page when adapter work starts.
- **X Layer TapeOut**: entries MUST use TapeOut circuits, contracts, or
  on-chain data on X Layer, or run in the X Layer DeWEB environment — a new
  integration to learn. Shortlisted teams attend an OFFLINE Demo Day in
  Singapore (travel not covered — flag to Rakha if we get shortlisted).
  Prize split: 1st 20,000 ×1; 2nd 10,000 ×5; 3rd 6,000 ×5 USDT, paid in stages.
- **HackerNoon**: prize is mostly credits — $41,750 Nosana compute credits
  ($70 × 500 participants + $450 × 15 winners), $2,500 Arweave credits,
  $2,500 AR cash, $5,000 MEXC MX tokens. Grand prize = full ownership of the
  decentralizeai.tech domain + codebase. Entry = publish on HackerNoon +
  submit at DecentralizeAI.tech; multiple entries allowed; every eligible
  participant can claim $70 Nosana credits. Realistic cash is small — treat
  as a low-effort write-up adaptation, not a build target.
- **Arbitrum São Paulo**: prizes paid in USDG on Arbitrum One; winners must
  sign a grant agreement with the Foundation; 50% paid on winning, project
  must build exclusively on an Arbitrum chain. ≥1 of 3 overall prizes reserved
  for Robinhood Chain projects, ≥1 of 3 for Arbitrum — the Robinhood Chain
  angle fits (operator already works on RH chain). Event period 8–28 Feb 2027,
  winners announced 8 Mar 2027.

## Modular architecture (core vs adapters)

```
mintguard/
├── src/core/                  # CHAIN-AGNOSTIC — reused by every hackathon
│   ├── vetting/               #   engine: verdict/scoring/simulation (generic)
│   ├── policy.ts              #   spending limits: free-only, gas ceiling
│   ├── agent/                 #   orchestration: vet -> gate -> sign -> record
│   └── reputation/            #   ledger interface (local + on-chain impls)
├── src/adapters/              # PER-CHAIN — one per hackathon target
│   ├── bsc/                   #   BSC RPC + Sourcify + GoPlus (chain 56)
│   ├── near/                  #   NEAR Chain Signatures (MPC) + NEAR RPC
│   ├── xlayer/                #   X Layer EVM + TapeOut integration
│   ├── arbitrum/              #   Arbitrum Stylus/Solidity + Orbit/RH chain
│   └── evm/                   #   generic EVM adapter (shared by BSC/X Layer/Arbitrum)
├── src/contracts/             # Per-chain reputation contracts (NEAR, Solidity)
├── demo/                      # Web demo UI (shared, chain switcher)
└── docs/
    ├── rules-summary.md       # NEAR rules (verified)
    ├── architecture.md        # Core architecture
    └── strategy-multi-hackathon.md  # this file
```

Each adaptation = a new adapter + a submission angle + (sometimes) a small
on-chain contract — NOT a rewrite. The core vetting engine, policy gate and
agent orchestration stay identical.

## Work order

1. **Now → 14 Nov: NEAR MVP** (vetting + Chain Signatures + reputation ledger
   + demo + README + X demo post + submission). Nothing else touches this.
2. **15 Nov → 6 Dec: Arbitrum Dubai adapter** — Solidity/Stylus reputation
   contract deployed on Arbitrum Sepolia (testnet) / One; submission on
   HackQuest. Re-verify Dubai dates first.
3. **Parallel to (2): X Layer adapter** — EVM adapter reuse + TapeOut
   integration study; submit by 7 Dec via Google Form.
4. **Anytime in Round 2: HackerNoon write-up** — publish MintGuard as
   decentralized-AI-infra story on HackerNoon; claim $70 Nosana credits.
5. **Feb 2027: São Paulo adapter** — RH-chain-flavoured deployment of the
   reputation contract; submit by 28 Feb 2027.

## Hard rules (all targets)

- Verify FREE ENTRY from the official page before building each adapter.
  If a target turns out paid (fee/stake/deposit) → SKIP it and report.
- No paid mainnet transaction without Rakha's explicit approval.
- No secret/key/seed ever in any repo or file.
- Each submission discloses the shared-core baseline honestly (per NEAR
  Q-002/Q-005 and each event's own rules).
