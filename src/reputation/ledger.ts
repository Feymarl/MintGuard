// MintGuard — Reputation Ledger (local, append-only).
//
// Every vetting and every mint the agent performs is recorded here as one
// JSON line in data/ledger.jsonl (gitignored — run artefacts, never committed).
// The ledger is the agent's local reputation trail: judges (and the operator)
// can audit exactly what the agent vetted, what it minted, and what it
// refused. The on-chain NEAR reputation contract (src/reputation/contract.ts)
// is a stretch goal that would mirror these entries on-chain; the local
// ledger is the source of truth until then.
//
// Design:
//   - Append-only: entries are added with fs.appendFileSync, never edited or
//     deleted. A corrupt line is skipped on read (counted, not fatal).
//   - Pure core: parseLedgerText / summarizeLedger are pure functions over
//     strings/arrays, so they are unit-testable without touching disk.
//   - No secrets: an entry never contains a private key, seed, or raw
//     signature material — only public identifiers (addresses, tx hashes).

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LedgerKind = "vetting" | "mint";

export interface LedgerEntry {
  /** ISO-8601 timestamp of when the entry was recorded. */
  ts: string;
  kind: LedgerKind;
  /** EVM contract address vetted / minted. */
  contract: string;
  /** Chain key, e.g. "bsc" (vetting) or "bsc-testnet" (mint). */
  chain: string;
  verdict: string;
  /** 0-100 vetting score at the time of the entry. */
  score: number;
  /** NEAR account that ran the agent, e.g. "mintguard.testnet". */
  agentAccount: string;
  /** EVM address derived from the NEAR account (Chain Signatures). */
  derivedAddress: string;
  /** Broadcast tx hash (mint entries only). */
  txHash?: string;
  /** Short receipt / outcome note, e.g. "dry-run" or "mined block 123". */
  receipt?: string;
  notes?: string;
}

/** Default ledger file, resolved from the process working directory. */
export const DEFAULT_LEDGER_PATH = resolve(process.cwd(), "data", "ledger.jsonl");

/** Build a ledger entry. `ts` defaults to now; override in tests for determinism. */
export function makeEntry(
  fields: Omit<LedgerEntry, "ts"> & { ts?: string },
): LedgerEntry {
  const { ts, ...rest } = fields;
  return { ts: ts ?? new Date().toISOString(), ...rest };
}

/** Serialise one entry as a single JSON line (no trailing spaces). */
export function formatEntry(entry: LedgerEntry): string {
  return JSON.stringify(entry);
}

/**
 * Parse one ledger line. Returns the entry, or null when the line is blank
 * or malformed (caller counts/skips it — a bad line never kills the read).
 */
export function parseEntry(line: string): LedgerEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.ts !== "string" ||
    (o.kind !== "vetting" && o.kind !== "mint") ||
    typeof o.contract !== "string" ||
    typeof o.chain !== "string" ||
    typeof o.verdict !== "string" ||
    typeof o.score !== "number" ||
    typeof o.agentAccount !== "string" ||
    typeof o.derivedAddress !== "string"
  ) {
    return null;
  }
  const entry: LedgerEntry = {
    ts: o.ts,
    kind: o.kind,
    contract: o.contract,
    chain: o.chain,
    verdict: o.verdict,
    score: o.score,
    agentAccount: o.agentAccount,
    derivedAddress: o.derivedAddress,
  };
  if (typeof o.txHash === "string") entry.txHash = o.txHash;
  if (typeof o.receipt === "string") entry.receipt = o.receipt;
  if (typeof o.notes === "string") entry.notes = o.notes;
  return entry;
}

/** Parse whole ledger text. Pure. Returns entries + count of skipped lines. */
export function parseLedgerText(text: string): { entries: LedgerEntry[]; skipped: number } {
  const entries: LedgerEntry[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
    else skipped += 1;
  }
  return { entries, skipped };
}

/** Append one entry to the ledger file (creates parent dirs as needed). */
export function appendEntry(entry: LedgerEntry, filePath: string = DEFAULT_LEDGER_PATH): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, formatEntry(entry) + "\n", "utf8");
}

/** Read all entries from the ledger file. Missing file => empty ledger. */
export function listEntries(filePath: string = DEFAULT_LEDGER_PATH): LedgerEntry[] {
  if (!existsSync(filePath)) return [];
  return parseLedgerText(readFileSync(filePath, "utf8")).entries;
}

/** Read all entries plus the number of malformed lines skipped. */
export function listEntriesWithSkipped(
  filePath: string = DEFAULT_LEDGER_PATH,
): { entries: LedgerEntry[]; skipped: number } {
  if (!existsSync(filePath)) return { entries: [], skipped: 0 };
  return parseLedgerText(readFileSync(filePath, "utf8"));
}

export interface LedgerSummary {
  total: number;
  vettings: number;
  mints: number;
  /** Count per verdict string, e.g. { SAFE: 3, RISKY: 1, BLOCK: 0 }. */
  byVerdict: Record<string, number>;
  /** Count per agent NEAR account. */
  byAgent: Record<string, number>;
  /** Count per derived EVM address. */
  byDerivedAddress: Record<string, number>;
  /** Average vetting score across vetting entries (null when none). */
  avgScore: number | null;
  /** Distinct contracts seen. */
  contracts: string[];
}

/** Summarise a list of entries. Pure. */
export function summarizeLedger(entries: LedgerEntry[]): LedgerSummary {
  const byVerdict: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const byDerivedAddress: Record<string, number> = {};
  const contracts = new Set<string>();
  let vettings = 0;
  let mints = 0;
  let scoreSum = 0;
  let scored = 0;
  for (const e of entries) {
    byVerdict[e.verdict] = (byVerdict[e.verdict] ?? 0) + 1;
    byAgent[e.agentAccount] = (byAgent[e.agentAccount] ?? 0) + 1;
    byDerivedAddress[e.derivedAddress] = (byDerivedAddress[e.derivedAddress] ?? 0) + 1;
    contracts.add(e.contract.toLowerCase());
    if (e.kind === "vetting") {
      vettings += 1;
      scoreSum += e.score;
      scored += 1;
    } else {
      mints += 1;
    }
  }
  return {
    total: entries.length,
    vettings,
    mints,
    byVerdict,
    byAgent,
    byDerivedAddress,
    avgScore: scored > 0 ? scoreSum / scored : null,
    contracts: [...contracts].sort(),
  };
}

/** Convenience: read the ledger file and summarise it in one call. */
export function summary(filePath: string = DEFAULT_LEDGER_PATH): LedgerSummary {
  return summarizeLedger(listEntries(filePath));
}
