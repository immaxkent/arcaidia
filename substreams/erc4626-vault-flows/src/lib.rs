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
                block_timestamp: block_timestamp(&block),
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
                block_timestamp: block_timestamp(&block),
                log_index: log.index,
            }),
            Some(None) => continue,
            None => {}
        }
    }

    Ok(VaultFlows {
        deposits,
        withdraws,
    })
}

fn block_timestamp(block: &Block) -> u64 {
    block
        .header
        .as_ref()
        .and_then(|h| h.timestamp.as_ref())
        .map(|t| t.seconds as u64)
        .unwrap_or(0)
}
