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
import {
  assertBalanceCoversGas,
  buildLiveMintCalldata,
  buildMintCalldata,
  estimateGasCostWei,
  runLiveFullMint,
  verifySignatureRecovery,
  type LiveFullDeps,
} from "../src/agent/live-full.js";
import type { EvmUnsignedTx } from "../src/signing/broadcast.js";

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

  test("mint() verdict -> no-arg selector calldata (demo NFT happy path)", () => {
    const v = verdict({ simulatedFunction: "mint()" });
    const { calldata } = buildMintTx(v, { chainId: BSC_TESTNET_CHAIN_ID, dryRun: true });
    expect(calldata).toBe("0x1249c58b");
  });
});

describe("live-full calldata builders (offline)", () => {
  test("loose builder: mint() / mint(uint256) / mint(address) encode, unknown -> 0x", () => {
    expect(buildMintCalldata("mint()")).toBe("0x1249c58b");
    expect(buildMintCalldata("mint(uint256)")).toBe(
      new ethers.Interface(["function mint(uint256 quantity)"]).encodeFunctionData("mint", [1]),
    );
    const wallet = "0x1111111111111111111111111111111111111111";
    expect(buildMintCalldata("mint(address)", wallet)).toBe(
      new ethers.Interface(["function mint(address to)"]).encodeFunctionData("mint", [wallet]),
    );
    expect(buildMintCalldata("mint(address)")).toBe("0x"); // no wallet -> no calldata
    expect(buildMintCalldata("claimFree()")).toBe("0x");
    expect(buildMintCalldata(null)).toBe("0x");
  });

  test("strict builder: known shapes work, unknown shapes throw (never empty calldata live)", () => {
    expect(buildLiveMintCalldata("mint()", "0x1111111111111111111111111111111111111111")).toBe(
      "0x1249c58b",
    );
    expect(buildLiveMintCalldata("mint(uint256)", "0x1111111111111111111111111111111111111111")).toBe(
      new ethers.Interface(["function mint(uint256 quantity)"]).encodeFunctionData("mint", [1]),
    );
    expect(() =>
      buildLiveMintCalldata("claimFree()", "0x1111111111111111111111111111111111111111"),
    ).toThrow(/no known calldata builder/);
    expect(() =>
      buildLiveMintCalldata(null, "0x1111111111111111111111111111111111111111"),
    ).toThrow(/no known calldata builder/);
    expect(() => buildLiveMintCalldata("mint(address)", "")).toThrow(
      /no known calldata builder/,
    );
  });
});

describe("live-full gas + balance guards (offline)", () => {
  test("estimateGasCostWei: EIP-1559 uses maxFeePerGas, legacy uses gasPrice", () => {
    expect(
      estimateGasCostWei({ gasLimit: 200_000n, maxFeePerGas: 1_000_000_000n }),
    ).toBe(200_000n * 1_000_000_000n);
    expect(estimateGasCostWei({ gasLimit: 100_000n, gasPrice: 5_000_000_000n })).toBe(
      100_000n * 5_000_000_000n,
    );
    // maxFeePerGas wins when both are present
    expect(
      estimateGasCostWei({
        gasLimit: 100_000n,
        gasPrice: 5_000_000_000n,
        maxFeePerGas: 1_000_000_000n,
      }),
    ).toBe(100_000n * 1_000_000_000n);
    expect(estimateGasCostWei({ maxFeePerGas: 1_000_000_000n })).toBeNull();
    expect(estimateGasCostWei({ gasLimit: 100_000n })).toBeNull();
    expect(estimateGasCostWei({})).toBeNull();
  });

  test("estimateGasCostWei: viem-style `gas` (what the chainsig adapter prepares)", () => {
    // A real prepared tx from the chainsig EVM adapter carries
    // { gas, maxFeePerGas, maxPriorityFeePerGas } — no `gasLimit`.
    // The estimator must read `gas` or the live flow refuses to
    // broadcast blind on every real mint.
    expect(
      estimateGasCostWei({ gas: 57_319n, maxFeePerGas: 100_000_000n }),
    ).toBe(57_319n * 100_000_000n);
    expect(estimateGasCostWei({ gas: 57_319n })).toBeNull();
    expect(estimateGasCostWei({ gas: 57_319n, gasPrice: 5_000_000_000n })).toBe(
      57_319n * 5_000_000_000n,
    );
    // gasLimit still wins when both are present
    expect(
      estimateGasCostWei({ gasLimit: 100_000n, gas: 57_319n, maxFeePerGas: 1_000_000_000n }),
    ).toBe(100_000n * 1_000_000_000n);
  });

  test("assertBalanceCoversGas: 0 fails with faucet hint, short fails, enough passes", () => {
    expect(() => assertBalanceCoversGas(0n, 100n)).toThrow(/bnbchain_official_bot/);
    expect(() => assertBalanceCoversGas(99n, 100n)).toThrow(/too low/);
    expect(() => assertBalanceCoversGas(100n, 100n)).not.toThrow();
    expect(() => assertBalanceCoversGas(101n, 100n)).not.toThrow();
  });

  test("verifySignatureRecovery: real signature matches, wrong address does not", () => {
    const wallet = new ethers.Wallet("0x" + "33".repeat(32));
    const hash = ethers.keccak256(ethers.toUtf8Bytes("mint-payload"));
    const sig = wallet.signingKey.sign(ethers.getBytes(hash));
    const ok = verifySignatureRecovery(ethers.getBytes(hash), sig, wallet.address);
    expect(ok.matches).toBe(true);
    expect(ok.recoveredAddress).toBe(wallet.address);
    const wrong = verifySignatureRecovery(
      ethers.getBytes(hash),
      sig,
      "0x2222222222222222222222222222222222222222",
    );
    expect(wrong.matches).toBe(false);
    // r/s without the 0x prefix still verify (normalization)
    const bare = verifySignatureRecovery(
      ethers.getBytes(hash),
      { r: sig.r.slice(2), s: sig.s.slice(2), v: sig.v },
      wallet.address,
    );
    expect(bare.matches).toBe(true);
  });
});

describe("runLiveFullMint with fake deps (offline, no network, no key)", () => {
  const testWallet = new ethers.Wallet("0x" + "11".repeat(32));
  const payloadHash = ethers.keccak256(ethers.toUtf8Bytes("mint-payload"));

  function makeDeps(overrides: Partial<LiveFullDeps> = {}) {
    const calls = { prepare: 0, sign: 0, finalize: 0, broadcast: 0 };
    const seen: { preparedData?: string; broadcastTx?: string } = {};
    const deps: LiveFullDeps = {
      getChainId: async () => 97,
      getBalance: async () => 10n ** 17n, // 0.1 tBNB
      prepare: async (req) => {
        calls.prepare++;
        seen.preparedData = req.data as string | undefined;
        return {
          transaction: {
            gasLimit: 200_000n,
            maxFeePerGas: 1_000_000_000n,
            chainId: 97,
          } as unknown as EvmUnsignedTx,
          hashesToSign: [ethers.getBytes(payloadHash)],
        };
      },
      sign: async (payload) => {
        calls.sign++;
        const sig = testWallet.signingKey.sign(payload);
        return { r: sig.r, s: sig.s, v: sig.v };
      },
      finalize: () => {
        calls.finalize++;
        return "0x02f8fakesignedtx";
      },
      broadcast: async (signedTx) => {
        calls.broadcast++;
        seen.broadcastTx = signedTx;
        return { hash: "0x" + "ab".repeat(32) };
      },
      waitReceipt: async () => ({ status: "success", blockNumber: 12345n, gasUsed: 150_000n }),
      readTotalSupply: async () => 7n,
      readOwnerOf: async () => testWallet.address,
      ...overrides,
    };
    return { deps, calls, seen };
  }

  function input(overrides: Partial<Parameters<typeof runLiveFullMint>[1]> = {}) {
    return {
      verdict: verdict(),
      derivedAddress: testWallet.address,
      policy: { mintValueWei: "0" },
      ...overrides,
    };
  }

  test("happy path: prepare -> sign -> finalize -> broadcast -> receipt -> ownerOf", async () => {
    const { deps, calls, seen } = makeDeps();
    const result = await runLiveFullMint(deps, input());
    expect(result.txHash).toBe("0x" + "ab".repeat(32));
    expect(result.tokenId).toBe(7n);
    expect(result.owner).toBe(testWallet.address);
    expect(result.estimatedGasWei).toBe(200_000n * 1_000_000_000n);
    expect(result.explorerTxUrl).toContain(result.txHash);
    expect(calls).toEqual({ prepare: 1, sign: 1, finalize: 1, broadcast: 1 });
    expect(seen.broadcastTx).toBe("0x02f8fakesignedtx");
  });

  test("mint() verdict sends the no-arg selector as calldata", async () => {
    const { deps, seen } = makeDeps();
    await runLiveFullMint(
      deps,
      input({ verdict: verdict({ simulatedFunction: "mint()" }) }),
    );
    expect(seen.preparedData).toBe("0x1249c58b");
  });

  test("tBNB = 0 fails fast with faucet instructions; sign + broadcast never run", async () => {
    const { deps, calls } = makeDeps({ getBalance: async () => 0n });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/bnbchain_official_bot/);
    expect(calls.prepare).toBe(0);
    expect(calls.sign).toBe(0);
    expect(calls.broadcast).toBe(0);
  });

  test("balance below estimated gas fails fast; sign never runs", async () => {
    const { deps, calls } = makeDeps({ getBalance: async () => 1n });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/too low/);
    expect(calls.sign).toBe(0);
    expect(calls.broadcast).toBe(0);
  });

  test("mainnet chainId (56) is refused before prepare", async () => {
    const { deps, calls } = makeDeps({ getChainId: async () => 56 });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/MAINNET/);
    expect(calls.prepare).toBe(0);
  });

  test("gas estimate over the 0.001 tBNB ceiling is refused; broadcast never runs", async () => {
    const { deps, calls } = makeDeps({
      prepare: async () => ({
        transaction: {
          gasLimit: 200_000n,
          maxFeePerGas: 10_000_000_000n, // 200k * 10 gwei = 0.002 tBNB > ceiling
          chainId: 97,
        } as unknown as EvmUnsignedTx,
        hashesToSign: [ethers.getBytes(payloadHash)],
      }),
    });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/exceeds ceiling/);
    expect(calls.sign).toBe(0);
    expect(calls.broadcast).toBe(0);
  });

  test("uncomputable gas cost refuses to broadcast blind", async () => {
    const { deps, calls } = makeDeps({
      prepare: async () => ({
        transaction: { chainId: 97 } as unknown as EvmUnsignedTx, // no gasLimit/fee
        hashesToSign: [ethers.getBytes(payloadHash)],
      }),
    });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(
      /could not determine the gas cost/,
    );
    expect(calls.broadcast).toBe(0);
  });

  test("signature that does not recover to the derived address aborts before broadcast", async () => {
    const other = new ethers.Wallet("0x" + "22".repeat(32));
    let signCalls = 0;
    const { deps, calls } = makeDeps({
      sign: async (payload) => {
        signCalls++;
        const sig = other.signingKey.sign(payload);
        return { r: sig.r, s: sig.s, v: sig.v };
      },
    });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/recovers to/);
    expect(signCalls).toBe(1);
    expect(calls.broadcast).toBe(0);
  });

  test("reverted receipt fails with the tx hash for explorer follow-up", async () => {
    const { deps } = makeDeps({
      waitReceipt: async () => ({ status: "reverted", blockNumber: 12346n, gasUsed: 150_000n }),
    });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/reverted on-chain/);
  });

  test("ownerOf mismatch fails even after a successful receipt", async () => {
    const { deps } = makeDeps({
      readOwnerOf: async () => "0x2222222222222222222222222222222222222222",
    });
    await expect(runLiveFullMint(deps, input())).rejects.toThrow(/ownerOf\(7\)/);
  });

  test("unknown simulated function fails before prepare (no empty-calldata tx)", async () => {
    const { deps, calls } = makeDeps();
    await expect(
      runLiveFullMint(
        deps,
        input({ verdict: verdict({ simulatedFunction: "claimFree()" }) }),
      ),
    ).rejects.toThrow(/no known calldata builder/);
    expect(calls.prepare).toBe(0);
  });
});
