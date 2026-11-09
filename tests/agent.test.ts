// MintGuard — policy gate + signing seam tests (offline, deterministic).
// Covers the full policy matrix (testnet-only, free-only, simulation,
// verdict tiers, gas ceiling) and the DryRunSigner contract. No network.

import { describe, test, expect } from "vitest";
import { ethers } from "ethers";
import type { VettingVerdict } from "../src/vetting/core/types.js";
import {
  checkPolicy,
  BSC_MAINNET_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  DEFAULT_MAX_GAS_WEI,
} from "../src/agent/policy.js";
import { DryRunSigner, DryRunBroadcaster } from "../src/agent/types.js";
import { buildMintTx } from "../src/agent/demo.js";

function verdict(overrides: Partial<VettingVerdict> = {}): VettingVerdict {
  return {
    contract: "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE",
    chain: "bsc",
    chainId: 56,
    verified: true,
    exactMatch: true,
    isProxy: false,
    implementation: null,
    mintPriceWei: "0",
    freeQuotaRemaining: 100,
    totalMinted: 3096,
    maxSupply: 10000,
    simulationOk: true,
    simulationError: null,
    simulatedFunction: "mint(uint256)",
    risks: [],
    score: 92,
    verdict: "SAFE",
    ...overrides,
  };
}

describe("policy gate (offline)", () => {
  test("happy path: SAFE + free + simulated + testnet + gas under ceiling => allowed", () => {
    const d = checkPolicy(verdict(), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      estimatedGasWei: 10n ** 14n,
    });
    expect(d.allowed).toBe(true);
    expect(d.checks).toHaveLength(5);
    expect(d.checks.every((c) => c.passed)).toBe(true);
  });

  test("mainnet (56) is always refused, even for a SAFE free mint", () => {
    const d = checkPolicy(verdict(), { chainId: BSC_MAINNET_CHAIN_ID, mintValueWei: "0" });
    expect(d.allowed).toBe(false);
    expect(d.checks.find((c) => c.name === "testnet-only")?.passed).toBe(false);
    expect(d.reason).toMatch(/MAINNET/);
  });

  test("unknown chain id is refused", () => {
    const d = checkPolicy(verdict(), { chainId: 1, mintValueWei: "0" });
    expect(d.allowed).toBe(false);
  });

  test("BLOCK verdict never proceeds, even with humanApprovedExact", () => {
    const d = checkPolicy(verdict({ verdict: "BLOCK", score: 10 }), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      humanApprovedExact: true,
    });
    expect(d.allowed).toBe(false);
  });

  test("NOT_MINT verdict never proceeds, even with humanApprovedExact", () => {
    const d = checkPolicy(verdict({ verdict: "NOT_MINT", score: 0 }), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      humanApprovedExact: true,
    });
    expect(d.allowed).toBe(false);
  });

  test("RISKY needs humanApprovedExact; with it, it passes", () => {
    const v = verdict({ verdict: "RISKY", score: 55 });
    const blocked = checkPolicy(v, { chainId: BSC_TESTNET_CHAIN_ID, mintValueWei: "0" });
    expect(blocked.allowed).toBe(false);
    const approved = checkPolicy(v, {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      humanApprovedExact: true,
    });
    expect(approved.allowed).toBe(true);
  });

  test("paid mint (>0 wei) is refused without human approval; allowed with it", () => {
    const v = verdict({ mintPriceWei: "1000000000000000" });
    const blocked = checkPolicy(v, {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "1000000000000000",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/paid mints need explicit human approval/);
    const approved = checkPolicy(v, {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "1000000000000000",
      humanApprovedExact: true,
    });
    expect(approved.allowed).toBe(true);
  });

  test("unreadable mint price (null) is refused — cannot prove free", () => {
    const d = checkPolicy(verdict({ mintPriceWei: null }), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: undefined,
    });
    expect(d.allowed).toBe(false);
    expect(d.checks.find((c) => c.name === "free-only")?.passed).toBe(false);
  });

  test("failed simulation aborts, even with human approval", () => {
    const d = checkPolicy(
      verdict({ simulationOk: false, simulationError: "execution reverted: sold out" }),
      { chainId: BSC_TESTNET_CHAIN_ID, mintValueWei: "0", humanApprovedExact: true },
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/simulation failed/);
  });

  test("gas over the default 0.001 tBNB ceiling is refused (hard cap)", () => {
    const d = checkPolicy(verdict(), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      estimatedGasWei: DEFAULT_MAX_GAS_WEI + 1n,
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/exceeds ceiling/);
  });

  test("gas exactly at the ceiling passes; custom ceiling is honoured", () => {
    const atCeiling = checkPolicy(verdict(), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      estimatedGasWei: DEFAULT_MAX_GAS_WEI,
    });
    expect(atCeiling.allowed).toBe(true);
    const custom = checkPolicy(verdict(), {
      chainId: BSC_TESTNET_CHAIN_ID,
      mintValueWei: "0",
      estimatedGasWei: 500n,
      maxGasWei: 400n,
    });
    expect(custom.allowed).toBe(false);
  });

  test("missing gas estimate does not block (checked at broadcast time)", () => {
    const d = checkPolicy(verdict(), { chainId: BSC_TESTNET_CHAIN_ID, mintValueWei: "0" });
    expect(d.allowed).toBe(true);
    expect(d.checks.find((c) => c.name === "gas-ceiling")?.passed).toBe(true);
  });

  test("multiple failures are all reported in the reason", () => {
    const d = checkPolicy(verdict({ verdict: "BLOCK", score: 5, simulationOk: false }), {
      chainId: BSC_MAINNET_CHAIN_ID,
      mintValueWei: "1000",
    });
    expect(d.allowed).toBe(false);
    expect(d.checks.filter((c) => !c.passed).length).toBeGreaterThanOrEqual(4);
  });
});

describe("DryRunSigner / DryRunBroadcaster (offline)", () => {
  test("deriveAddress is deterministic per (account, path) and a valid address", async () => {
    const s = new DryRunSigner();
    const a1 = await s.deriveAddress("mintguard.testnet", "ethereum-1");
    const a2 = await s.deriveAddress("mintguard.testnet", "ethereum-1");
    const a3 = await s.deriveAddress("other.testnet", "ethereum-1");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(a3);
    expect(ethers.isAddress(a1)).toBe(true);
  });

  test("sign returns a deterministic fake signature (r == s marks it as fake)", async () => {
    const s = new DryRunSigner();
    const payload = ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes("mint")));
    const sig1 = await s.sign(payload, "ethereum-1");
    const sig2 = await s.sign(payload, "ethereum-1");
    expect(sig1).toEqual(sig2);
    expect(sig1.r).toBe(sig1.s); // real ECDSA signatures never have r == s
    expect(sig1.v).toBe(27);
  });

  test("broadcast returns a deterministic fake tx hash", async () => {
    const b = new DryRunBroadcaster();
    const h1 = await b.broadcast("0xdeadbeef");
    const h2 = await b.broadcast("0xdeadbeef");
    expect(h1.txHash).toBe(h2.txHash);
    expect(ethers.isHexString(h1.txHash, 32)).toBe(true);
  });
});

describe("demo mint-tx build + dry-run sign/broadcast (offline)", () => {
  test("happy path: SAFE verdict -> mint(1) tx on chain 97, signable, broadcastable", async () => {
    const v = verdict(); // SAFE, free, simulated
    const { tx, signingHash, calldata } = buildMintTx(v, {
      chainId: BSC_TESTNET_CHAIN_ID,
      dryRun: true,
    });
    expect(tx.chainId).toBe(97n);
    expect(tx.to?.toLowerCase()).toBe(v.contract.toLowerCase());
    expect(tx.value).toBe(0n);
    // calldata is mint(uint256) with quantity 1
    expect(calldata).toBe(
      new ethers.Interface(["function mint(uint256 quantity)"]).encodeFunctionData("mint", [1]),
    );
    expect(ethers.isHexString(signingHash, 32)).toBe(true);

    const signer = new DryRunSigner();
    const sig = await signer.sign(ethers.getBytes(signingHash), "ethereum-1");
    tx.signature = sig;
    expect(tx.serialized.startsWith("0x")).toBe(true);

    const broadcaster = new DryRunBroadcaster();
    const { txHash } = await broadcaster.broadcast(tx.serialized);
    expect(ethers.isHexString(txHash, 32)).toBe(true);
  });

  test("unknown mint function -> empty calldata, tx still builds", () => {
    const v = verdict({ simulatedFunction: "claimFree()" });
    const { calldata } = buildMintTx(v, { chainId: BSC_TESTNET_CHAIN_ID, dryRun: true });
    expect(calldata).toBe("0x");
  });
});
