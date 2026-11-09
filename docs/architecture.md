# MintGuard — Architecture

## Problem

AI agents are now asked to spend money on-chain — minting NFTs, claiming drops,
paying for services. Today an agent that mints faces two bad options:

1. Hold a raw EVM private key (one leak = wallet drained), or
2. Blindly trust whatever contract a post links to (free-mint scams, honeypots,
   hidden fees, fake "free" mints that drain approvals are routine on BSC).

Humans who hunt free mints solve this with a slow manual checklist: verify the
contract on Sourcify, read the source, check the quota, simulate the mint.
MintGuard automates that checklist into an agent — and gives the agent a wallet
it cannot leak.

## What MintGuard is

An AI agent that vets any BSC free-mint contract and, only on a clean verdict,
executes the mint cross-chain from a NEAR account via **NEAR Chain Signatures**:
one NEAR account derives an EVM address and signs BSC transactions through
NEAR's MPC network. No seed or private key ever exists on the agent's machine.
Every vetting + mint is recorded as the agent's on-chain reputation.

## Modules

```
mintguard/
├── src/vetting/     # Step 1 — VET (read-only, BSC) — DONE 2026-11-09, 27/27 tests pass
│   ├── core/        #   CHAIN-AGNOSTIC engine: types, selectors, scoring,
│   │   │            #   simulate (eth_call), safety (GoPlus), engine
│   │   ├── types.ts / selectors.ts / scoring.ts
│   │   ├── simulate.ts / safety.ts / engine.ts
│   ├── adapters/bsc.ts  # BSC adapter: dataseed RPC (browser UA), Sourcify 56,
│   │                    # GoPlus 56, registry + getAdapter()
│   ├── sourcify.ts / rpc.ts / verdict.ts  # vetContract() entry point
│   └── cli.ts       # `npm run vet -- --ca <addr> [--wallet <addr>] [--chain bsc]`
├── src/signing/     # Step 2 — SIGN (NEAR Chain Signatures, MPC) — in progress
│   ├── derive.ts    # Derive the agent's EVM address from its NEAR account (offline)
│   ├── mpc.ts       # Request an MPC signature for an EVM tx payload
│   └── broadcast.ts # Assemble + broadcast the signed BSC tx
├── src/reputation/  # Step 3 — RECORD (agent reputation)
│   ├── ledger.ts    # Local append-only record of vettings + mints
│   └── contract.ts  # (stretch) NEAR contract storing reputation entries
├── src/agent/       # Orchestration: vet -> (human policy gate) -> sign -> record
│   ├── demo.ts      # End-to-end demo runner (testnet / simulation)
│   └── policy.ts    # Spending limits: free mints only, gas ceiling, allowlist
└── demo/            # Static web demo UI (vet a contract, see the verdict)
```

Layout note (2026-11-09): the vetting engine lives at `src/vetting/core/` with
its BSC adapter at `src/vetting/adapters/bsc.ts` — chain-agnostic core +
per-chain adapter as specified in the 15:22 strategy update. A final
consolidation to `src/core/` + `src/adapters/<chain>/` (as sketched in
`docs/strategy-multi-hackathon.md`) happens at MVP assembly, before
submission; it is a pure file move, no logic change.

## Flow

```
User pastes a mint contract
  → VET: Sourcify + source read + quota + eth_call simulation + safety scan
  → Verdict: SAFE (score ≥ threshold) / RISKY (needs human) / BLOCK (never)
  → Policy gate: free-only, gas ceiling, no approvals beyond the mint itself
  → SIGN: NEAR account → MPC signs the BSC mint tx → broadcast
  → RECORD: vetting + outcome appended to the agent's reputation ledger
```

## NEAR technology used

- **Chain Signatures (MPC)** — the core: the agent's EVM address is derived
  from its NEAR account; signing happens in NEAR's MPC network, so no private
  key ever lives on the agent host. This is the differentiator.
- **NEAR testnet** — all signing demos run on testnet with free faucet funds
  (Q-008/Q-010: testnet-only projects are eligible in all tracks).
- **NEAR Intents** (stretch) — swap the minted asset / pay for services with
  intents instead of holding the asset.

## Tracks

- Primary: `agents` (Agent Economy) — an agent with a wallet that earns/spends
  without ever holding a key.
- Also: `security` (AI Security & Defense) — scam detection, spending limits,
  sandboxed wallets, reputation.
- Also: `open` (Open Innovation).

## Baseline disclosure (HACKATHON.md Q-002 / Q-005)

The vetting heuristics (Sourcify check, quota reads, eth_call simulation,
selector handling) come from the operator's pre-hackathon BSC mint playbooks,
used in production since Oct 2026 (dozens of verified free mints). Only the
NEAR integration — Chain Signatures execution + on-chain agent reputation +
the agent orchestration — was built inside the hackathon window, and that is
what is judged. Pre-existing code is listed in the README as baseline.

## Security invariants

- Read-only until the policy gate: vetting never sends a transaction.
- No private key / seed / API key is ever written to the repo or any file.
  Keys live in environment variables (`.env.local`, gitignored).
- Free mints only: any mint with `value > 0` beyond gas is BLOCKed by policy
  unless a human explicitly approves that exact action.
- Every mint is simulated with `eth_call` immediately before signing; a
  reverted simulation aborts the flow.
- `totalSupply()` is never used as "remaining supply" — quota is read from
  `totalMinted()` / `remaining()` / `maxSupply()`.

## Timeline to deadline (deadline: 14 Nov 2026 23:59 UTC = 15 Nov 06:59 WIB)

- 9 Nov: rules + architecture + skeleton; vetting pipeline working; Chain
  Signatures research + offline derivation example.
- 10–11 Nov: MPC signing on NEAR testnet end-to-end (derive → sign → broadcast
  on BSC testnet or Sepolia-style simulation); reputation ledger; demo UI.
- 12 Nov: full demo recording (video), README "do X — see Y", polish.
- 13 Nov: dry-run of the whole judge path from a clean checkout; public repo
  push (by the human); demo post draft for X.
- 14 Nov: human posts demo on X; human confirms submission payload; submit
  via API/form before 23:59 UTC.

## Multi-hackathon modular design (update 2026-11-09 ~15:22 WIB)

MintGuard is built ONCE as a chain-agnostic core and adapted per hackathon —
never rebuilt from scratch. See `docs/strategy-multi-hackathon.md` for the
full target list (NEAR 14 Nov $250k → Arbitrum Dubai 6 Dec $30k → X Layer
7 Dec 100k USDT → HackerNoon 27 Feb $51,750+ → Arbitrum São Paulo 1 Mar
$115k; all verified FREE entry; XRPL + HackMeridian verified CLOSED).

```
src/core/        # vetting engine (generic), policy gate, agent orchestration,
                 # reputation ledger interface — identical for every hackathon
src/adapters/    # per-chain: bsc/ (Sourcify+GoPlus), near/ (Chain Signatures
                 # MPC), xlayer/ (EVM + TapeOut), arbitrum/ (Stylus/Solidity),
                 # evm/ (shared EVM base)
src/contracts/   # per-chain reputation contracts
```

Rule: each adaptation = new adapter + submission angle (+ sometimes a small
contract). The vetting subagent was instructed to structure `src/vetting/`
as core + BSC adapter accordingly. NEAR MVP comes first; no December target
may jeopardise the 14 Nov deadline.
