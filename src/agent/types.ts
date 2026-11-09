// MintGuard — Agent orchestration types + signing seam.
//
// INTEGRATION SEAM (read this before wiring the live signer):
// The live MPC signer lives in src/signing/mpc.ts, built in parallel by
// another worker. This file defines the SMALL interface demo.ts depends on,
// so the demo never imports src/signing/ directly and never blocks on it:
//
//   SigningProvider {
//     deriveAddress(accountId, path): Promise<string>   // EVM address (offline math)
//     sign(payload, path): Promise<{ r, s, v }>         // MPC signature over 32-byte hash
//   }
//
// When src/signing/mpc.ts lands, it must export a class/function that
// satisfies this interface (e.g. `new MpcSigner(nearAccount)` or a factory
// `createMpcSigner(...)`). demo.ts loads it lazily via dynamic import and
// fails with a clear message if the module is not ready yet — it never
// crashes mysteriously and never falls back to a fake signature in live mode.
//
// DryRunSigner below is the ONLY fake signer, used ONLY in --dry-run mode,
// and its signatures are visibly marked DRY-RUN everywhere they appear.

export interface EcdsaSignature {
  /** 32-byte r, 0x-prefixed hex. */
  r: string;
  /** 32-byte s, 0x-prefixed hex. */
  s: string;
  /** Recovery id (27 | 28). */
  v: number;
}

export interface SigningProvider {
  /**
   * Derive the agent's EVM address from its NEAR account + derivation path.
   * Pure MPC math (see src/signing/example-derive.ts) — no key material.
   */
  deriveAddress(accountId: string, path: string): Promise<string>;
  /**
   * Ask the NEAR MPC network to sign a 32-byte payload hash (e.g. an EIP-155
   * signing hash) for the given derivation path.
   */
  sign(payload: Uint8Array, path: string): Promise<EcdsaSignature>;
}

/** A broadcast provider: takes a signed raw tx and returns its hash. */
export interface BroadcastProvider {
  broadcast(signedRawTx: string): Promise<{ txHash: string }>;
}

export type DemoMode = "vet" | "sign" | "full";

/**
 * Dry-run signer. Returns a deterministic FAKE signature that is clearly
 * marked as such — it is NOT a real MPC signature and can never be
 * broadcast. Used only when demo.ts runs with --dry-run.
 */
export class DryRunSigner implements SigningProvider {
  async deriveAddress(accountId: string, path: string): Promise<string> {
    // Deterministic placeholder derived from the account id, so dry runs
    // are reproducible. NOT a real derived address — see the DRY-RUN tag
    // in demo output.
    const { ethers } = await import("ethers");
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`dry-run:${accountId}:${path}`));
    return ethers.getAddress("0x" + hash.slice(-40));
  }

  async sign(payload: Uint8Array, _path: string): Promise<EcdsaSignature> {
    const { ethers } = await import("ethers");
    // Fake r/s derived from the payload hash — deterministic, obviously
    // not an MPC signature (r == s pattern would never occur on-chain).
    const h = ethers.keccak256(payload);
    return {
      r: "0x" + h.slice(2, 66),
      s: "0x" + h.slice(2, 66),
      v: 27,
    };
  }
}

/**
 * Dry-run broadcaster. Returns a deterministic fake tx hash, clearly
 * marked DRY-RUN. Used only in --dry-run mode.
 */
export class DryRunBroadcaster implements BroadcastProvider {
  async broadcast(signedRawTx: string): Promise<{ txHash: string }> {
    const { ethers } = await import("ethers");
    return { txHash: ethers.keccak256(ethers.toUtf8Bytes(`dry-run-tx:${signedRawTx}`)) };
  }
}
