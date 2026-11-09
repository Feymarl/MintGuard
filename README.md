# MintGuard — an AI agent that only mints what it has verified

> Built for **NEAR HACKATHON 2026: Build Beyond Boundaries** (1–14 Nov 2026).
> Track: **Agent Economy** (`agents`); also fits **AI Security & Defense**
> (`security`) and **Open Innovation** (`open`).

## The problem

AI agents are being asked to spend money on-chain — mint NFTs, claim drops,
pay for services. An agent that mints today has two bad options:

1. **Hold a raw EVM private key** — one leak and the wallet is drained.
2. **Trust whatever contract a post links to** — free-mint scams, honeypots,
   hidden fees and fake "free" mints that drain approvals are routine on BSC.

Humans who hunt free mints solve this with a slow manual checklist: verify
the contract on Sourcify, read the source, check the free quota, simulate
the mint before touching it. MintGuard automates that checklist into an
agent — and gives the agent a wallet it cannot leak.

## What MintGuard does

1. **VET** — the agent vets any BSC free-mint contract before anything else:
   Sourcify verification (ABI + source), proxy detection, free-quota reads
   (`totalMinted` / `remaining` / `maxSupply`), an `eth_call` simulation of
   the mint from the agent's wallet, and a honeypot/tax/owner safety scan.
   The result is a scored verdict: `SAFE`, `RISKY`, or `BLOCK`.
2. **SIGN** — only on a clean verdict, the mint is executed cross-chain from
   a NEAR account via **NEAR Chain Signatures**: the agent's EVM address is
   derived from its NEAR account and the BSC transaction is signed by NEAR's
   MPC network. **No seed or private key ever exists on the agent's machine.**
3. **RECORD** — every vetting and mint is appended to the agent's reputation
   ledger, so other agents (and humans) can check what this agent has
   verified before trusting it. The ledger is an **on-chain NEAR contract**
   (`mintguard.testnet` on testnet, `contracts/reputation-ledger/`):
   `record_verdict` appends one entry per vetting (contract, verdict,
   score, reason, chain, agent, timestamp); `get_verdict` /
   `list_verdicts` read it back. The local `data/ledger.jsonl` file is
   only a local mirror of the same entries.

## NEAR technology used

- **Chain Signatures (MPC)** — the core. `v1.signer` (mainnet) /
  `v1.signer-prod.testnet` (testnet). Derivation path is a free string
  (`ethereum-1`); see `docs/chain-signatures-research.md` for the verified
  formula, costs (1 yoctoNEAR deposit + ~7 TGas per `sign`), and the
  pitfalls we found (docs' example address is stale; NEAR secp256k1 keys are
  64-byte `x||y`).
- **NEAR testnet** — all signing demos run on testnet with free faucet funds
  (testnet-only projects are eligible in all tracks).
- **On-chain reputation ledger** — a Rust contract (`near-sdk` 5,
  `contracts/reputation-ledger/`) deployed to `mintguard.testnet` on
  testnet: `record_verdict` / `get_verdict` / `list_verdicts` /
  `verdict_count`. Live proof: GLOOP
  `0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE` → RISKY 70, recorded
  on-chain (see `scripts/record-verdict.ts` + `LEDGER_CORRECTION_NOTE.md`).
  Explorer: https://testnet.nearblocks.io/accounts/mintguard.testnet
- **NEAR Intents** (stretch) — swap the minted asset / pay for services with
  intents instead of holding the asset.

## Try it (do X — see Y)

Prerequisites: Node ≥ 20, `npm install`.

**1. Vet a real free-mint contract (read-only, no transaction):**

```sh
npm run vet -- --ca 0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE
```

Expected: JSON verdict — `verified: true`, `exact_match: true`,
`totalMinted: 3333`, `score: 70`, `verdict: "RISKY"` (this wallet already
minted GLOOP #3096, so the simulation correctly reverts with
`"already minted"`). Try a fresh wallet address with `--wallet <address>`
to see the simulation pass.

```sh
# Negative control — WBNB is not a mint contract:
npm run vet -- --ca 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c
# Expected: verdict "NOT_MINT", score 0.
```

**2. Derive the agent's EVM address from a NEAR account (offline, no key,
no network):**

```sh
npm run derive
# or: npx tsx src/signing/example-derive.ts
```

Expected: `example.testnet` + path `ethereum-1` →
`0xD8ebbAA4f6558cc6b322987194Fd663a976272bD`, self-check OK, exit 0.

**3. Run the tests:**

```sh
npm test   # 27 tests (23 offline + 4 live against BSC) — all pass
npx tsc --noEmit
```

**5. Read the on-chain reputation ledger (no key needed — view calls):**

```sh
npx tsx scripts/record-verdict.ts --ca 0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE
```

Expected: engine verdict `RISKY 70 — sim reverted: Agent ID required`,
then a `record_verdict` tx on NEAR testnet, then `get_verdict` read-back
showing the same verdict on-chain (`agent: "mintguard.testnet"`).
(This step DOES send a testnet transaction — it needs the agent key in
`.env.local`. To read the ledger without any key, query the contract
directly: https://testnet.nearblocks.io/accounts/mintguard.testnet)

**4. End-to-end demo:** `npm run demo` (vet → derive → MPC sign →
BSC-testnet mint in one flow) is still in progress — `src/agent/` is empty
and the live MPC `sign` validation is the next build step (10–11 Nov, see
`docs/architecture.md` timeline). What exists today:
- **Demo UI:** open `demo/index.html` (static, no build step, no backend) —
  `python3 -m http.server` in `demo/` and visit
  `http://127.0.0.1:8000/index.html`. It shows the 3 steps (VET → SIGN →
  RECORD), the real vet/derive outputs captured 9 Nov 2026, and a form that
  builds the exact `npm run vet` command for any contract — it never
  fabricates a verdict.
- **Video script:** `docs/demo-script.md` (scenes, exact commands, expected
  outputs, narration, asset checklist). The video itself is recorded 12 Nov
  (planned); if the live MPC sign lands first, it becomes Scene 3B.
- **Submission pack:** `docs/submission.md` (checklist + payload template
  with human-decided fields left as placeholders + X post draft).

## Project structure

```
src/vetting/core/        # Chain-agnostic vetting engine (types, selectors,
                         # scoring, eth_call simulation, safety, engine)
src/vetting/adapters/bsc.ts  # BSC adapter (dataseed RPC, Sourcify, GoPlus)
src/vetting/             # vetContract() entry point + CLI
src/signing/             # NEAR Chain Signatures (derive, MPC sign, broadcast)
src/reputation/          # Agent reputation ledger: on-chain NEAR contract
                         # (contracts/reputation-ledger/, live on testnet)
                         # + local JSONL mirror (data/ledger.jsonl)
src/agent/               # Orchestration + policy gate (free-only, gas ceiling)
demo/                    # Web demo UI
docs/                    # rules-summary, architecture, chain-signatures research,
                         # vetting pipeline, multi-hackathon strategy
tests/                   # 27 tests incl. live fixtures (GLOOP, Mechfarm,
                         # Minority Pass, WBNB negative control)
```

## Baseline disclosure (HACKATHON.md Q-002 / Q-005)

The vetting heuristics (Sourcify check, quota reads, `eth_call` simulation,
selector handling) come from the operator's pre-hackathon BSC mint playbooks,
used in production since Oct 2026 across dozens of verified free mints. Only
the NEAR integration — Chain Signatures execution, on-chain agent reputation,
and the agent orchestration — was built inside the hackathon window, and that
is what is judged here. The same modular core is later adapted for other
hackathons (see `docs/strategy-multi-hackathon.md`); each adaptation is a new
chain adapter + submission angle, not a rewrite.

## Security invariants

- Read-only until the policy gate: vetting never sends a transaction.
- No private key / seed / API key is ever written to this repo. Keys live in
  environment variables (`.env.local`, gitignored).
- Free mints only: any mint with `value > 0` beyond gas is BLOCKed by policy
  unless a human explicitly approves that exact action.
- Every mint is simulated with `eth_call` immediately before signing; a
  reverted simulation aborts the flow.
- `totalSupply()` is never used as "remaining supply" — quota is read from
  `totalMinted()` / `remaining()` / `maxSupply()`.

## Status

- [x] Official rules verified (near.org + nearhackathon.com + HACKATHON.md)
- [x] Vetting pipeline working (27/27 tests, live CLI verdicts)
- [x] Chain Signatures research verified (MPC root key confirmed live via
      NEAR testnet RPC; offline derivation example runs, self-check OK)
- [x] Demo UI (`demo/index.html`: 3 steps, real verified vet/derive outputs,
      contract-address form that builds the exact CLI command — no fake
      verdicts) + video script (`docs/demo-script.md`) + submission pack
      (`docs/submission.md`)
- [ ] Day-1 validation: live MPC `sign` + BSC testnet broadcast
- [x] Reputation ledger ON-CHAIN (NEAR testnet contract `mintguard.testnet`,
      `contracts/reputation-ledger/`; GLOOP → RISKY 70 recorded + read back,
      see `LEDGER_CORRECTION_NOTE.md`)
- [ ] Agent orchestration
- [ ] Demo video (script ready, record 12 Nov) + submission (repo public, X
      demo post, form before 14 Nov 2026 23:59 UTC)

## License

MIT — see `LICENSE`.
