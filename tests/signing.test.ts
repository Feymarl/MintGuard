/**
 * MintGuard — test offline untuk modul signing (tanpa network, tanpa key).
 *
 * Mencakup: rumus derivasi (vektor on-chain yang tercatat), guard chainId
 * testnet-only, dan verifikasi recovery tanda tangan ECDSA dengan
 * signature yang dibuat lokal (ethers Wallet).
 */
import { describe, it, expect } from "vitest";
import { Wallet, ethers } from "ethers";
import {
  KNOWN_VECTORS,
  deriveChildPublicKey,
  deriveEvmAddress,
  derivedPublicKeyToEvmAddress,
} from "../src/signing/derive.js";
import {
  BSC_MAINNET_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  assertBscTestnetChainId,
} from "../src/signing/broadcast.js";
import { verifySignatureRecovery } from "../src/signing/mpc.js";

describe("derive.ts — rumus KDF Chain Signatures", () => {
  it("vektor testnet cocok dengan derived_public_key on-chain", () => {
    const v = KNOWN_VECTORS["testnet|example.testnet|ethereum-1"];
    const { derivedPublicKey, evmAddress } = deriveEvmAddress(
      "example.testnet",
      "ethereum-1",
      "testnet",
    );
    expect(derivedPublicKey).toBe(v.derivedPubkey);
    expect(evmAddress.toLowerCase()).toBe(v.evmAddress.toLowerCase());
  });

  it("vektor mainnet cocok dengan derived_public_key on-chain", () => {
    const v = KNOWN_VECTORS["mainnet|example.near|ethereum-1"];
    const { derivedPublicKey, evmAddress } = deriveEvmAddress(
      "example.near",
      "ethereum-1",
      "mainnet",
    );
    expect(derivedPublicKey).toBe(v.derivedPubkey);
    expect(evmAddress.toLowerCase()).toBe(v.evmAddress.toLowerCase());
  });

  it("derivedPublicKeyToEvmAddress konsisten dengan deriveEvmAddress", () => {
    const { derivedPublicKey, evmAddress } = deriveEvmAddress(
      "mintguard.testnet",
      "ethereum-1",
      "testnet",
    );
    expect(derivedPublicKeyToEvmAddress(derivedPublicKey)).toBe(evmAddress);
    expect(ethers.isAddress(evmAddress)).toBe(true);
  });

  it("path berbeda -> alamat berbeda", () => {
    const a = deriveEvmAddress("mintguard.testnet", "ethereum-1", "testnet");
    const b = deriveEvmAddress("mintguard.testnet", "ethereum-2", "testnet");
    expect(a.evmAddress).not.toBe(b.evmAddress);
  });

  it("root key bukan 64 byte ditolak", () => {
    expect(() => deriveChildPublicKey("secp256k1:abc", "x.testnet", "ethereum-1")).toThrow();
  });
});

describe("broadcast.ts — guard chainId testnet-only", () => {
  it("menerima BSC testnet 97", () => {
    expect(() => assertBscTestnetChainId(BSC_TESTNET_CHAIN_ID)).not.toThrow();
  });

  it("menolak BSC mainnet 56", () => {
    expect(() => assertBscTestnetChainId(BSC_MAINNET_CHAIN_ID)).toThrow(/MAINNET/);
  });

  it("menolak chainId lain (mis. Ethereum 1)", () => {
    expect(() => assertBscTestnetChainId(1)).toThrow(/bukan BSC testnet/);
  });
});

describe("mpc.ts — verifikasi recovery ECDSA offline", () => {
  it("recovery dari signature lokal cocok dengan alamat signer", async () => {
    const wallet = Wallet.createRandom();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("MintGuard test"));
    const sig = wallet.signingKey.sign(hash);
    const { recoveredAddress, matches } = verifySignatureRecovery(
      ethers.getBytes(hash),
      { r: sig.r.slice(2), s: sig.s.slice(2), v: sig.v },
      wallet.address,
    );
    expect(recoveredAddress.toLowerCase()).toBe(wallet.address.toLowerCase());
    expect(matches).toBe(true);
  });

  it("recovery dengan alamat yang salah -> matches false", async () => {
    const wallet = Wallet.createRandom();
    const other = Wallet.createRandom();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("MintGuard test"));
    const sig = wallet.signingKey.sign(hash);
    const { matches } = verifySignatureRecovery(
      ethers.getBytes(hash),
      { r: sig.r.slice(2), s: sig.s.slice(2), v: sig.v },
      other.address,
    );
    expect(matches).toBe(false);
  });
});
