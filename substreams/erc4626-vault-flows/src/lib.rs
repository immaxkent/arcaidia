//! Generic ERC-4626 vault-flow indexing.
//!
//! Watches every address in a block for the two standard EIP-4626 events —
//! `Deposit` and `Withdraw` — by event *signature*, never by an allowlisted
//! address. That's the whole point: this module has to be useful to a
//! stranger's conforming vault with zero configuration, not just Arcaidia's
//! own, so nothing here may hardcode a specific vault address. Arcaidia's own
//! extensions beyond the standard (`outstandingExposure`, `reserveFloor`,
//! `maxFillBps`) are deliberately absent — see `WP-ERC4626-SUBSTREAMS.md` §2.

mod abi;
mod graph_out;
pub mod pb;

use pb::erc4626::v1::{Deposit, VaultFlows, Withdraw};
use substreams::errors::Error;
use substreams_ethereum::pb::eth::v2::Block;

#[substreams::handlers::map]
fn map_vault_flows(block: Block) -> Result<VaultFlows, Error> {
    Ok(extract_vault_flows(&block))
}

/// The actual logic, as a plain function taking `&Block` — same split as
/// `graph_out`/`build_entity_changes`. `#[substreams::handlers::map]`
/// rewrites its function's signature to the wasm host-call ABI, so the
/// macro-wrapped `map_vault_flows` itself isn't callable like an ordinary
/// function from a test; this is.
fn extract_vault_flows(block: &Block) -> VaultFlows {
    let mut deposits = Vec::new();
    let mut withdraws = Vec::new();

    for log_view in block.logs() {
        let log = log_view.log;
        let vault = format!("0x{}", hex::encode(&log.address));
        let tx_hash = format!("0x{}", hex::encode(&log_view.receipt.transaction.hash));

        match abi::decode_deposit(log) {
            Some(Some(decoded)) => deposits.push(Deposit {
                vault: vault.clone(),
                sender: decoded.sender,
                owner: decoded.owner,
                assets: Some(decoded.assets),
                shares: Some(decoded.shares),
                tx_hash: tx_hash.clone(),
                block_number: block.number,
                block_timestamp: block_timestamp(block),
                log_index: log.index,
            }),
            Some(None) => continue, // matched topic0 but malformed data — skip, don't fail the block
            None => {}
        }

        match abi::decode_withdraw(log) {
            Some(Some(decoded)) => withdraws.push(Withdraw {
                vault,
                sender: decoded.sender,
                receiver: decoded.receiver,
                owner: decoded.owner,
                assets: Some(decoded.assets),
                shares: Some(decoded.shares),
                tx_hash,
                block_number: block.number,
                block_timestamp: block_timestamp(block),
                log_index: log.index,
            }),
            Some(None) => continue,
            None => {}
        }
    }

    VaultFlows {
        deposits,
        withdraws,
    }
}

fn block_timestamp(block: &Block) -> u64 {
    block
        .header
        .as_ref()
        .and_then(|h| h.timestamp.as_ref())
        .map(|t| t.seconds as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use substreams_ethereum::pb::eth::v2::{BlockHeader, TransactionReceipt, TransactionTrace};

    fn topic_addr(byte: u8) -> Vec<u8> {
        let mut topic = vec![0u8; 12];
        topic.extend_from_slice(&[byte; 20]);
        topic
    }

    fn word(v: u64) -> Vec<u8> {
        let mut word = vec![0u8; 32];
        word[24..32].copy_from_slice(&v.to_be_bytes());
        word
    }

    /// A raw `Log` for the standard `Deposit` event at the given vault
    /// address, otherwise arbitrary values.
    fn raw_deposit_log(vault: u8, index: u32) -> substreams_ethereum::pb::eth::v2::Log {
        let mut data = word(1_000_000);
        data.extend_from_slice(&word(999_000));
        substreams_ethereum::pb::eth::v2::Log {
            address: vec![vault; 20],
            topics: vec![
                abi::DEPOSIT_TOPIC0.to_vec(),
                topic_addr(0x11),
                topic_addr(0x22),
            ],
            data,
            index,
            block_index: index,
            ordinal: index as u64,
        }
    }

    fn raw_withdraw_log(vault: u8, index: u32) -> substreams_ethereum::pb::eth::v2::Log {
        let mut data = word(500_000);
        data.extend_from_slice(&word(480_000));
        substreams_ethereum::pb::eth::v2::Log {
            address: vec![vault; 20],
            topics: vec![
                abi::WITHDRAW_TOPIC0.to_vec(),
                topic_addr(0x11),
                topic_addr(0x33),
                topic_addr(0x22),
            ],
            data,
            index,
            block_index: index,
            ordinal: index as u64,
        }
    }

    fn irrelevant_log(index: u32) -> substreams_ethereum::pb::eth::v2::Log {
        substreams_ethereum::pb::eth::v2::Log {
            address: vec![0xff; 20],
            topics: vec![vec![0xaa; 32]],
            data: vec![],
            index,
            block_index: index,
            ordinal: index as u64,
        }
    }

    /// One transaction, `status: 1` (successful — `block.logs()` silently
    /// skips anything else, see substreams-ethereum's own `transactions()`),
    /// carrying the given logs in its receipt.
    fn transaction(hash: u8, logs: Vec<substreams_ethereum::pb::eth::v2::Log>) -> TransactionTrace {
        TransactionTrace {
            hash: vec![hash; 32],
            status: 1,
            receipt: Some(TransactionReceipt {
                logs,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn block(transaction_traces: Vec<TransactionTrace>) -> Block {
        Block {
            number: 12_345,
            header: Some(BlockHeader {
                timestamp: Some(prost_types::Timestamp {
                    seconds: 1_800_000_000,
                    nanos: 0,
                }),
                ..Default::default()
            }),
            transaction_traces,
            ..Default::default()
        }
    }

    #[test]
    fn extracts_a_single_deposit_from_a_single_transaction() {
        let b = block(vec![transaction(0xaa, vec![raw_deposit_log(0x11, 0)])]);
        let flows = extract_vault_flows(&b);

        assert_eq!(flows.deposits.len(), 1);
        assert_eq!(flows.withdraws.len(), 0);
        assert_eq!(flows.deposits[0].vault, format!("0x{}", "11".repeat(20)));
        assert_eq!(flows.deposits[0].block_number, 12_345);
        assert_eq!(flows.deposits[0].block_timestamp, 1_800_000_000);
    }

    /// The genericness bar, at the block level rather than the single-log
    /// level abi.rs already covers: two entirely different vault addresses
    /// in the same block must both be picked up, not just the first one
    /// seen or one specific allowlisted address.
    #[test]
    fn picks_up_deposits_from_two_different_vaults_in_the_same_block() {
        let b = block(vec![
            transaction(0xaa, vec![raw_deposit_log(0x11, 0)]),
            transaction(0xbb, vec![raw_deposit_log(0x99, 0)]),
        ]);
        let flows = extract_vault_flows(&b);

        let vaults: Vec<&str> = flows.deposits.iter().map(|d| d.vault.as_str()).collect();
        assert_eq!(vaults.len(), 2);
        assert!(vaults.contains(&format!("0x{}", "11".repeat(20)).as_str()));
        assert!(vaults.contains(&format!("0x{}", "99".repeat(20)).as_str()));
    }

    #[test]
    fn a_mixed_block_separates_deposits_withdraws_and_ignores_unrelated_logs() {
        let b = block(vec![transaction(
            0xaa,
            vec![
                raw_deposit_log(0x11, 0),
                irrelevant_log(1),
                raw_withdraw_log(0x11, 2),
            ],
        )]);
        let flows = extract_vault_flows(&b);

        assert_eq!(flows.deposits.len(), 1);
        assert_eq!(flows.withdraws.len(), 1);
    }

    /// Not documented anywhere obvious — found by reading
    /// substreams-ethereum's own source: `Block::logs()` is built on
    /// `transactions()`, which filters to `status == 1` only. A reverted
    /// transaction's logs never happened from the chain's own perspective,
    /// so silently excluding them is correct — worth a test precisely
    /// because it's easy to assume `logs()` sees everything in the block.
    #[test]
    fn a_reverted_transactions_logs_are_never_counted() {
        let mut reverted = transaction(0xaa, vec![raw_deposit_log(0x11, 0)]);
        reverted.status = 0;
        let b = block(vec![reverted]);

        assert_eq!(extract_vault_flows(&b).deposits.len(), 0);
    }

    #[test]
    fn an_empty_block_produces_empty_vault_flows() {
        let flows = extract_vault_flows(&block(vec![]));
        assert!(flows.deposits.is_empty());
        assert!(flows.withdraws.is_empty());
    }

    #[test]
    fn does_not_special_case_arcaidias_own_vault_address_at_the_block_level() {
        // Same genericness bar as abi.rs's own test, exercised through the
        // full block-extraction path rather than the decoder in isolation.
        let arbitrary_vault = 0x42;
        let b = block(vec![transaction(
            0xaa,
            vec![raw_deposit_log(arbitrary_vault, 0)],
        )]);
        assert_eq!(extract_vault_flows(&b).deposits.len(), 1);
    }
}
