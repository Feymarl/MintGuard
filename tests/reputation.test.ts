// MintGuard — reputation ledger tests (offline, deterministic).
// Covers: entry serialisation/parsing, malformed-line tolerance,
// append-only file behaviour, and summary counts. No network.

import { describe, test, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  formatEntry,
  listEntries,
  listEntriesWithSkipped,
  makeEntry,
  parseEntry,
  parseLedgerText,
  summarizeLedger,
  summary,
  type LedgerEntry,
} from "../src/reputation/ledger.js";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return makeEntry({
    kind: "vetting",
    contract: "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE",
    chain: "bsc",
    verdict: "SAFE",
    score: 92,
    agentAccount: "mintguard.testnet",
    derivedAddress: "0xD8ebbAA4f6558cc6b322987194Fd663a976272bD",
    ...overrides,
  });
}

describe("ledger entry format/parse (offline)", () => {
  test("formatEntry produces one JSON line that parseEntry round-trips", () => {
    const e = entry({ ts: "2026-11-09T10:00:00.000Z", txHash: "0xabc", notes: "hi" });
    const parsed = parseEntry(formatEntry(e));
    expect(parsed).toEqual(e);
  });

  test("parseEntry rejects blank, malformed, and incomplete lines", () => {
    expect(parseEntry("")).toBeNull();
    expect(parseEntry("   ")).toBeNull();
    expect(parseEntry("{not json")).toBeNull();
    expect(parseEntry("[1,2,3]")).toBeNull();
    expect(parseEntry(JSON.stringify({ kind: "vetting" }))).toBeNull(); // missing fields
    expect(parseEntry(JSON.stringify({ ...entry(), kind: "bogus" }))).toBeNull();
    expect(parseEntry(JSON.stringify({ ...entry(), score: "92" }))).toBeNull();
  });

  test("parseLedgerText skips bad lines and counts them", () => {
    const text = [
      formatEntry(entry({ verdict: "SAFE" })),
      "{broken json",
      "",
      formatEntry(entry({ verdict: "BLOCK", score: 10, kind: "mint", txHash: "0x1" })),
    ].join("\n");
    const { entries, skipped } = parseLedgerText(text);
    expect(entries).toHaveLength(2);
    expect(entries[1].verdict).toBe("BLOCK");
    expect(skipped).toBe(1);
  });

  test("makeEntry defaults ts to now (ISO) and keeps an explicit ts", () => {
    const auto = entry();
    expect(auto.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(entry({ ts: "2026-01-01T00:00:00.000Z" }).ts).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("ledger file behaviour (offline, temp dir)", () => {
  test("appendEntry creates the file and appends; listEntries reads back in order", () => {
    const dir = mkdtempSync(join(tmpdir(), "mintguard-ledger-"));
    try {
      const file = join(dir, "sub", "ledger.jsonl");
      appendEntry(entry({ verdict: "SAFE" }), file);
      appendEntry(entry({ verdict: "RISKY", score: 55 }), file);
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      const listed = listEntries(file);
      expect(listed).toHaveLength(2);
      expect(listed[0].verdict).toBe("SAFE");
      expect(listed[1].verdict).toBe("RISKY");
      // Append-only: a second append does not rewrite earlier lines.
      expect(lines[0]).toBe(formatEntry(listed[0]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("listEntries on a missing file returns [] and summary is empty", () => {
    const file = join(mkdtempSync(join(tmpdir(), "mintguard-ledger-")), "nope.jsonl");
    expect(listEntries(file)).toEqual([]);
    expect(listEntriesWithSkipped(file)).toEqual({ entries: [], skipped: 0 });
    expect(summary(file).total).toBe(0);
    expect(summary(file).avgScore).toBeNull();
  });
});

describe("summarizeLedger (offline)", () => {
  test("counts per verdict / agent / kind and averages vetting scores", () => {
    const entries = [
      entry({ verdict: "SAFE", score: 90 }),
      entry({ verdict: "SAFE", score: 80 }),
      entry({ verdict: "RISKY", score: 50, agentAccount: "other.testnet" }),
      entry({ verdict: "SAFE", score: 95, kind: "mint", txHash: "0xdead" }),
      entry({ verdict: "BLOCK", score: 10, contract: "0x0000000000000000000000000000000000000001" }),
    ];
    const s = summarizeLedger(entries);
    expect(s.total).toBe(5);
    expect(s.vettings).toBe(4);
    expect(s.mints).toBe(1);
    expect(s.byVerdict).toEqual({ SAFE: 3, RISKY: 1, BLOCK: 1 });
    expect(s.byAgent).toEqual({ "mintguard.testnet": 4, "other.testnet": 1 });
    expect(s.byDerivedAddress).toEqual({ "0xD8ebbAA4f6558cc6b322987194Fd663a976272bD": 5 });
    expect(s.avgScore).toBeCloseTo((90 + 80 + 50 + 10) / 4);
    expect(s.contracts).toEqual([
      "0x0000000000000000000000000000000000000001",
      "0x183cbb52b3c7bcb2433d50de0add99b59f4de4fe",
    ]);
  });

  test("empty ledger summarises to zeros", () => {
    const s = summarizeLedger([]);
    expect(s).toEqual({
      total: 0,
      vettings: 0,
      mints: 0,
      byVerdict: {},
      byAgent: {},
      byDerivedAddress: {},
      avgScore: null,
      contracts: [],
    });
  });
});
