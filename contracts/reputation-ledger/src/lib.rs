//! MintGuard Reputation Ledger — on-chain, append-only record of vetting verdicts.
//!
//! Deployed on NEAR testnet (account `mintguard.testnet`). Each
//! `record_verdict` call appends one entry: (EVM contract address, verdict,
//! score, reason, chain, recording agent, block timestamp). Entries are
//! never edited or deleted; a later verdict for the same contract
//! supersedes the earlier one for `get_verdict`, while `list_verdicts`
//! keeps the full append-only history.
//!
//! This replaces the local `data/ledger.jsonl` file: the ledger is now
//! public and auditable on-chain, which is what the NEAR Hackathon
//! submission's "reputation ledger" claim refers to.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId};

/// One recorded vetting verdict.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Verdict {
    /// EVM contract address vetted (stored lowercased).
    pub contract: String,
    /// Verdict: "SAFE" | "RISKY" | "BLOCK" | "NOT_MINT".
    pub verdict: String,
    /// Vetting score, 0-100.
    pub score: u8,
    /// Short human-readable reason (e.g. "sim reverted: Agent ID required").
    pub reason: String,
    /// Chain key, e.g. "bsc" / "bsc-testnet" / "base-sepolia".
    pub chain: String,
    /// NEAR account that recorded the verdict (the agent).
    pub agent: AccountId,
    /// Block timestamp (nanoseconds) when the verdict was recorded.
    pub recorded_at_ns: u64,
}

#[near(contract_state)]
pub struct ReputationLedger {
    /// Latest verdict per contract (key = lowercased EVM address).
    latest: LookupMap<String, Verdict>,
    /// Full append-only history, in record order.
    history: Vec<Verdict>,
}

const ALLOWED_VERDICTS: [&str; 4] = ["SAFE", "RISKY", "BLOCK", "NOT_MINT"];

// `store::LookupMap` has no `Default` impl, so the contract state gets one
// manually — the `#[near]` macro loads state via `unwrap_or_default`.
impl Default for ReputationLedger {
    fn default() -> Self {
        Self {
            latest: LookupMap::new(b"l"),
            history: Vec::new(),
        }
    }
}

#[near]
impl ReputationLedger {
    #[init]
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one vetting verdict. Append-only: the history grows and
    /// `latest` is overwritten for the contract. The recording agent is
    /// `predecessor_account_id` (the agent's NEAR account).
    pub fn record_verdict(
        &mut self,
        contract_address: String,
        verdict: String,
        score: u8,
        reason: String,
        chain: String,
    ) {
        let contract = contract_address.trim().to_lowercase();
        assert!(!contract.is_empty(), "contract address must not be empty");
        assert!(
            contract.starts_with("0x") && contract.len() == 42,
            "contract must be a 0x EVM address"
        );
        assert!(
            ALLOWED_VERDICTS.contains(&verdict.as_str()),
            "verdict must be SAFE, RISKY, BLOCK or NOT_MINT"
        );
        assert!(score <= 100, "score must be 0-100");
        assert!(reason.len() <= 500, "reason must be <= 500 chars");
        assert!(!chain.is_empty(), "chain must not be empty");
        let entry = Verdict {
            contract: contract.clone(),
            verdict,
            score,
            reason,
            chain,
            agent: env::predecessor_account_id(),
            recorded_at_ns: env::block_timestamp(),
        };
        self.latest.insert(contract, entry.clone());
        self.history.push(entry);
    }

    /// Latest verdict for a contract, or null when never vetted.
    pub fn get_verdict(&self, contract_address: String) -> Option<Verdict> {
        self.latest.get(&contract_address.trim().to_lowercase()).cloned()
    }

    /// Append-only history, paginated (defaults: from 0, limit 100, max 100).
    pub fn list_verdicts(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Verdict> {
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(100).min(100) as usize;
        if from >= self.history.len() {
            return Vec::new();
        }
        let end = (from + limit).min(self.history.len());
        self.history[from..end].to_vec()
    }

    /// Total number of recorded verdicts.
    pub fn verdict_count(&self) -> u64 {
        self.history.len() as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_then_read_back() {
        let mut ledger = ReputationLedger::new();
        ledger.record_verdict(
            "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE".to_string(),
            "RISKY".to_string(),
            70,
            "sim reverted: Agent ID required".to_string(),
            "bsc".to_string(),
        );
        assert_eq!(ledger.verdict_count(), 1);
        let v = ledger
            .get_verdict("0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE".to_string())
            .expect("verdict stored");
        assert_eq!(v.verdict, "RISKY");
        assert_eq!(v.score, 70);
        assert_eq!(v.contract, "0x183cbb52b3c7bcb2433d50de0add99b59f4de4fe");
        assert_eq!(ledger.list_verdicts(None, None).len(), 1);
    }

    #[test]
    #[should_panic(expected = "score must be 0-100")]
    fn rejects_score_over_100() {
        let mut ledger = ReputationLedger::new();
        ledger.record_verdict(
            "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE".to_string(),
            "SAFE".to_string(),
            101,
            "x".to_string(),
            "bsc".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "verdict must be SAFE")]
    fn rejects_bad_verdict() {
        let mut ledger = ReputationLedger::new();
        ledger.record_verdict(
            "0x183CBb52B3C7BCB2433d50dE0Add99B59f4DE4fE".to_string(),
            "MAYBE".to_string(),
            50,
            "x".to_string(),
            "bsc".to_string(),
        );
    }
}
