// MintGuard — vetting tests.
// Two tiers:
//   1. OFFLINE (always run): selector math, scoring, quota derivation,
//      GoPlus parsing, arg building, revert-reason parsing.
//   2. NETWORK (auto-skipped when BSC RPC / Sourcify is unreachable):
//      live vetting of real, previously free-minted BSC contracts.
//      These are read-only (eth_call + HTTP GET); no transaction is sent.

import { describe, test, expect } from "vitest";
import { ethers } from "ethers";
import { selector, READ_SIGNATURES, isMintCandidate } from "../src/vetting/core/selectors.js";
import { scoreVetting, deriveFreeQuota, hasMintFunction, buildVerdict } from "../src/vetting/core/scoring.js";
import { placeholderArgs, shortRevertReason } from "../src/vetting/core/simulate.js";
import { parseGoPlusResponse } from "../src/vetting/core/safety.js";
import { getAdapter } from "../src/vetting/adapters/bsc.js";
import { vetContract } from "../src/vetting/verdict.js";
import type { VettingInput } from "../src/vetting/core/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINT_ABI = [
  { type: "function", name: "mint", inputs: [{ name: "quantity", type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "totalMinted", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
];

const NO_MINT_ABI = [
  { type: "function", name: "deposit", inputs: [], stateMutability: "payable" },
  { type: "function", name: "withdraw", inputs: [{ name: "wad", type: "uint256" }], stateMutability: "nonpayable" },
];

function baseInput(overrides: Partial<VettingInput> = {}): VettingInput {
  return {
    contract: "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE",
    sourcify: { verified: true, exactMatch: true, contractName: "GLOOP", abi: MINT_ABI },
    chain: {
      hasCode: true,
      totalMinted: 3096,
      totalSupply: 3096,
      maxSupply: 10000,
      remaining: null,
      mintPriceWei: 0n,
      paused: false,
      owner: "0x0000000000000000000000000000000000000000",
      implementationSlot: null,
    },
    tokenSecurity: null,
    simulation: { ok: true, error: null, fn: "mint(uint256)" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. OFFLINE — selectors
// ---------------------------------------------------------------------------

describe("selectors (offline)", () => {
  test("totalMinted() selector is 0xa2309ff8 (verified on-chain)", () => {
    expect(selector(READ_SIGNATURES.totalMinted)).toBe("0xa2309ff8");
  });

  test("0x817b1cd2 is NOT totalMinted — the old wrong selector must not appear", () => {
    expect(selector(READ_SIGNATURES.totalMinted)).not.toBe("0x817b1cd2");
  });

  test("selector() equals ethers.id first 4 bytes", () => {
    expect(selector("mint(uint256)")).toBe(ethers.id("mint(uint256)").slice(0, 10));
    expect(selector("claimFree()")).toBe(ethers.id("claimFree()").slice(0, 10));
  });
});

// ---------------------------------------------------------------------------
// 2. OFFLINE — scoring / verdict
// ---------------------------------------------------------------------------

describe("scoring (offline)", () => {
  test("clean free mint scores 100 and verdicts SAFE", () => {
    const { score, verdict, risks } = scoreVetting(baseInput());
    expect(score).toBe(100);
    expect(verdict).toBe("SAFE");
    expect(risks).toHaveLength(0);
  });

  test("unverified contract is BLOCK with capped score", () => {
    const { score, verdict } = scoreVetting(
      baseInput({ sourcify: { verified: false, exactMatch: false, contractName: null, abi: MINT_ABI } }),
    );
    expect(verdict).toBe("BLOCK");
    expect(score).toBeLessThanOrEqual(19);
  });

  test("paused contract is BLOCK", () => {
    const { verdict } = scoreVetting(baseInput({ chain: { ...baseInput().chain, paused: true } }));
    expect(verdict).toBe("BLOCK");
  });

  test("honeypot (GoPlus) is BLOCK", () => {
    const { verdict } = scoreVetting(
      baseInput({ tokenSecurity: { isHoneypot: true, buyTax: null, sellTax: null, ownerRenounced: null } }),
    );
    expect(verdict).toBe("BLOCK");
  });

  test("tax > 10% is BLOCK; tax 6-10% only deducts", () => {
    const high = scoreVetting(
      baseInput({ tokenSecurity: { isHoneypot: false, buyTax: 12, sellTax: 0, ownerRenounced: true } }),
    );
    expect(high.verdict).toBe("BLOCK");
    const mid = scoreVetting(
      baseInput({ tokenSecurity: { isHoneypot: false, buyTax: 8, sellTax: 0, ownerRenounced: true } }),
    );
    expect(mid.verdict).toBe("RISKY");
    expect(mid.score).toBe(75);
  });

  test("paid mint deducts 25 and verdicts RISKY, never SAFE", () => {
    const { score, verdict, risks } = scoreVetting(
      baseInput({ chain: { ...baseInput().chain, mintPriceWei: 1000000000000000n } }),
    );
    expect(score).toBe(75);
    expect(verdict).toBe("RISKY");
    expect(risks.some((r) => r.code === "paid_mint")).toBe(true);
  });

  test("contract without mint/claim function is NOT_MINT with score 0", () => {
    const { score, verdict, risks } = scoreVetting(
      baseInput({ sourcify: { verified: true, exactMatch: true, contractName: "WBNB", abi: NO_MINT_ABI } }),
    );
    expect(verdict).toBe("NOT_MINT");
    expect(score).toBe(0);
    expect(risks[0].code).toBe("not_mint");
  });

  test("address with no code is NOT_MINT", () => {
    const { verdict } = scoreVetting(baseInput({ chain: { ...baseInput().chain, hasCode: false } }));
    expect(verdict).toBe("NOT_MINT");
  });

  test("failed simulation deducts 30 but does not BLOCK (gated mints exist)", () => {
    const { score, verdict } = scoreVetting(
      baseInput({ simulation: { ok: false, error: "Invalid proof", fn: "mint(address,uint256)" } }),
    );
    expect(score).toBe(70);
    expect(verdict).toBe("RISKY");
  });

  test("partial Sourcify match deducts 10", () => {
    const { score } = scoreVetting(
      baseInput({ sourcify: { verified: true, exactMatch: false, contractName: "X", abi: MINT_ABI } }),
    );
    expect(score).toBe(90);
  });
});

describe("quota derivation (offline)", () => {
  test("remaining() wins when present", () => {
    expect(deriveFreeQuota({ remaining: 42, totalMinted: 900, maxSupply: 1000 })).toBe(42);
  });

  test("maxSupply - totalMinted when no remaining()", () => {
    expect(deriveFreeQuota({ remaining: null, totalMinted: 2855, maxSupply: 3000 })).toBe(145);
  });

  test("totalSupply is NEVER used as remaining — burned tokens must not inflate quota", () => {
    // Chip404 lesson: totalSupply 2855/3000 looked like "145 left", but
    // totalMinted was already 3000 = maxSupply -> actually SOLD OUT (0).
    expect(deriveFreeQuota({ remaining: null, totalMinted: 3000, maxSupply: 3000 })).toBe(0);
    expect(deriveFreeQuota({ remaining: null, totalMinted: null, maxSupply: 3000 })).toBeNull();
  });

  test("isMintCandidate rejects admin/getter lookalikes", () => {
    expect(isMintCandidate("mint")).toBe(true);
    expect(isMintCandidate("claimFree")).toBe(true);
    expect(isMintCandidate("publicMint")).toBe(true);
    expect(isMintCandidate("setMintOpen")).toBe(false);
    expect(isMintCandidate("freeClaimed")).toBe(false);
    expect(isMintCandidate("mintPrice")).toBe(false);
    expect(isMintCandidate("isMintOpen")).toBe(false);
    expect(isMintCandidate("deposit")).toBe(false);
  });

  test("hasMintFunction detects mint/claim names only", () => {
    expect(hasMintFunction(MINT_ABI)).toBe(true);
    expect(hasMintFunction(NO_MINT_ABI)).toBe(false);
    expect(
      hasMintFunction([{ type: "function", name: "claimFree", inputs: [], stateMutability: "nonpayable" }]),
    ).toBe(true);
  });
});

describe("helpers (offline)", () => {
  test("placeholderArgs: address -> wallet, quantity uint -> 1, other uint -> 0", () => {
    const iface = new ethers.Interface([
      "function mint(address to, uint256 quantity, uint256 nonce)",
    ]);
    const fn = iface.getFunction("mint")!;
    const args = placeholderArgs(fn, "0xC35438581552BDe41e705ec301eeB17F13DDF021");
    expect(args[0]).toBe("0xC35438581552BDe41e705ec301eeB17F13DDF021");
    expect(args[1]).toBe(1n);
    expect(args[2]).toBe(0n);
  });

  test("shortRevertReason extracts reason strings", () => {
    expect(shortRevertReason({ reason: "Mint closed" })).toBe("Mint closed");
    expect(
      shortRevertReason(new Error("execution reverted: Mint closed")),
    ).toBe("Mint closed");
    expect(
      shortRevertReason({ message: "call revert exception; reverted with reason string 'Sold out'" }),
    ).toBe("Sold out");
  });

  test("parseGoPlusResponse maps honeypot/tax/owner", () => {
    const addr = "0xabc0000000000000000000000000000000000000";
    const parsed = parseGoPlusResponse(
      { result: { [addr]: { is_honeypot: "1", buy_tax: "5", sell_tax: "0", owner_address: "0x1234000000000000000000000000000000000000" } } },
      addr,
    );
    expect(parsed).toEqual({ isHoneypot: true, buyTax: 5, sellTax: 0, ownerRenounced: false });
    expect(parseGoPlusResponse({ result: {} }, addr)).toBeNull();
  });

  test("getAdapter rejects unknown chains", () => {
    expect(() => getAdapter("solana")).toThrow(/Unknown chain/);
    expect(getAdapter("bsc").chainId).toBe(56);
  });

  test("buildVerdict assembles the full JSON shape", () => {
    const v = buildVerdict(baseInput(), "bsc", 56);
    expect(v.contract).toBe("0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE");
    expect(v.chain).toBe("bsc");
    expect(v.chainId).toBe(56);
    expect(v.verified).toBe(true);
    expect(v.freeQuotaRemaining).toBe(6904);
    expect(v.totalMinted).toBe(3096);
    expect(v.maxSupply).toBe(10000);
    expect(v.verdict).toBe("SAFE");
  });
});

// ---------------------------------------------------------------------------
// 3. NETWORK — live contracts (auto-skipped when RPC/Sourcify unreachable)
// ---------------------------------------------------------------------------

const NETWORK_OK: boolean = await (async () => {
  try {
    const r = await fetch("https://bsc-dataseed1.bnbchain.org", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
})();

describe("live vetting (network — skipped when RPC unreachable)", () => {
  test.skipIf(!NETWORK_OK)("GLOOP is verified and NOT blocked as unverified", async () => {
    const v = await vetContract("0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE");
    expect(v.verified).toBe(true);
    expect(v.exactMatch).toBe(true);
    expect(v.verdict).not.toBe("BLOCK");
    expect(v.verdict).not.toBe("NOT_MINT");
    expect(v.totalMinted).not.toBeNull();
  }, 60_000);

  test.skipIf(!NETWORK_OK)("Mechfarm is verified, free, and vetted", async () => {
    const v = await vetContract("0x1fab92b937572c79550aeee51cee77d3add20367");
    expect(v.verified).toBe(true);
    expect(["SAFE", "RISKY"]).toContain(v.verdict);
    // Mechfarm exposes no mintPrice()/price()/cost() getter, so the price
    // reads as null (unknown).
    expect(v.mintPriceWei).toBeNull();
    // The real mint(uint256) is simulated — but it currently REVERTS
    // (custom error 0x888e58a8, even from a fresh wallet: mint window
    // closed or free lane exhausted). The engine must report that honestly
    // as RISKY with the revert recorded, never fake a SAFE.
    expect(v.simulatedFunction).toMatch(/^mint\(/);
    expect(v.simulationOk).toBe(false);
    expect(v.simulationError).toBeTruthy();
    expect(v.risks.some((r) => r.code === "simulation_revert")).toBe(true);
  }, 60_000);

  test.skipIf(!NETWORK_OK)("Minority Pass is verified (sold out is RISKY, not BLOCK)", async () => {
    const v = await vetContract("0xc4ad3ac9e8994867210a3f6fdb779211187d19fa");
    expect(v.verified).toBe(true);
    expect(v.verdict).not.toBe("BLOCK");
    expect(v.verdict).not.toBe("NOT_MINT");
  }, 60_000);

  test.skipIf(!NETWORK_OK)("WBNB is recognised as NOT a mint contract", async () => {
    const v = await vetContract("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c");
    expect(v.verdict).toBe("NOT_MINT");
    expect(v.score).toBe(0);
    expect(v.risks[0].code).toBe("not_mint");
  }, 60_000);
});
