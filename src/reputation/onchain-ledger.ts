// MintGuard — on-chain reputation ledger client (NEAR testnet).
//
// Wraps the `mintguard-reputation-ledger` contract deployed on NEAR
// testnet: `record_verdict` (change) + `get_verdict` / `list_verdicts` /
// `verdict_count` (view). Uses the project's existing @near-js patterns
// from src/signing/mpc.ts — no new signing path, no new key handling.
//
// The contract lives at LEDGER_CONTRACT_ID (the agent's own testnet
// account, which also pays the tiny storage cost of each entry).
// Testnet-only: every function here asserts network "testnet".

import { actionCreators } from "@near-js/transactions";
import type { Account } from "@near-js/accounts";
import { TESTNET_NEAR_RPC } from "../signing/mpc.js";

/** NEAR testnet account holding the ledger contract. */
export const LEDGER_CONTRACT_ID = "mintguard.testnet";

/** Gas attached to ledger calls (30 TGas — far above what one entry costs). */
export const LEDGER_CALL_GAS = 30_000_000_000_000n;

/** Explorer base for tx / account links (NEARBlocks testnet). */
export const LEDGER_EXPLORER = "https://testnet.nearblocks.io";

export interface OnChainVerdict {
  contract: string;
  verdict: string;
  score: number;
  reason: string;
  chain: string;
  agent: string;
  recorded_at_ns: number;
}

export interface RecordVerdictArgs {
  /** EVM contract address vetted (any case; the contract lowercases it). */
  contract_address: string;
  /** "SAFE" | "RISKY" | "BLOCK" | "NOT_MINT". */
  verdict: string;
  /** 0-100. */
  score: number;
  /** Short reason (<= 500 chars). */
  reason: string;
  /** Chain key, e.g. "bsc". */
  chain: string;
}

/** Tx hash out of a FinalExecutionOutcome, defensive across @near-js shapes. */
export function txHashOf(outcome: unknown): string {
  const o = outcome as {
    transaction?: { hash?: string };
    transaction_outcome?: { id?: string };
  };
  return o.transaction?.hash ?? o.transaction_outcome?.id ?? "unknown";
}

/**
 * Record one vetting verdict on-chain. `account` must be the agent's
 * testnet Account (see createNearAccount in src/signing/mpc.ts).
 * Returns the record tx hash.
 */
export async function recordVerdictOnChain(
  account: Account,
  args: RecordVerdictArgs,
): Promise<{ txHash: string }> {
  const outcome = await account.signAndSendTransaction({
    receiverId: LEDGER_CONTRACT_ID,
    actions: [
      actionCreators.functionCall(
        "record_verdict",
        {
          contract_address: args.contract_address,
          verdict: args.verdict,
          score: args.score,
          reason: args.reason,
          chain: args.chain,
        },
        LEDGER_CALL_GAS,
        0n,
      ),
    ],
  });
  return { txHash: txHashOf(outcome) };
}

/** Raw JSON-RPC view call against the ledger contract. */
export async function viewLedger<T>(
  method: string,
  args: Record<string, unknown> = {},
  rpcUrl: string = TESTNET_NEAR_RPC,
): Promise<T> {
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `mintguard-ledger-${method}`,
      method: "query",
      params: {
        request_type: "call_function",
        account_id: LEDGER_CONTRACT_ID,
        method_name: method,
        args_base64: argsBase64,
        finality: "final",
      },
    }),
  });
  const json = (await res.json()) as {
    result?: { result?: number[] };
    error?: { message?: string };
  };
  if (json.error || !json.result?.result) {
    throw new Error(
      `View call ${method} failed: ${json.error?.message ?? "no result"}`,
    );
  }
  return JSON.parse(Buffer.from(json.result.result).toString("utf8")) as T;
}

/** Latest on-chain verdict for a contract (null when never vetted). */
export async function getVerdictOnChain(
  contractAddress: string,
): Promise<OnChainVerdict | null> {
  return viewLedger<OnChainVerdict | null>("get_verdict", {
    contract_address: contractAddress,
  });
}

/** Append-only on-chain history, paginated. */
export async function listVerdictsOnChain(
  fromIndex = 0,
  limit = 100,
): Promise<OnChainVerdict[]> {
  return viewLedger<OnChainVerdict[]>("list_verdicts", {
    from_index: fromIndex,
    limit,
  });
}

/** Total number of verdicts recorded on-chain. */
export async function verdictCountOnChain(): Promise<number> {
  return viewLedger<number>("verdict_count", {});
}

/** NEAR balance (in NEAR, not yocto) of an account, via RPC view_account. */
export async function accountBalanceNear(
  accountId: string,
  rpcUrl: string = TESTNET_NEAR_RPC,
): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mintguard-balance",
      method: "query",
      params: {
        request_type: "view_account",
        account_id: accountId,
        finality: "final",
      },
    }),
  });
  const json = (await res.json()) as {
    result?: { amount?: string };
    error?: { message?: string };
  };
  if (json.error || !json.result?.amount) {
    throw new Error(
      `view_account ${accountId} failed: ${json.error?.message ?? "no result"}`,
    );
  }
  return Number(BigInt(json.result.amount)) / 1e24;
}
