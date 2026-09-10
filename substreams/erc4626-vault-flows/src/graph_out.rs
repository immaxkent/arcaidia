//! Turns `VaultFlows` into `EntityChanges` — the shape a
//! `substreams/graph-entities` subgraph data source expects its module to
//! emit directly (see `vault-flows-subgraph/subgraph.yaml`).
//!
//! Kept as its own module, downstream of `map_vault_flows` rather than
//! folded into it: `map_vault_flows`'s output (`VaultFlows`) is the generic,
//! reusable artifact — usable by anyone consuming this package directly,
//! Graph-entity subgraph or not. `graph_out` is one specific *consumer* of
//! that output, not part of the generic contract itself.

use crate::pb::erc4626::v1::{BigInt as RawBigInt, VaultFlows};
use substreams::errors::Error;
use substreams_entity_change::pb::entity::EntityChanges;
use substreams_entity_change::tables::Tables;

#[substreams::handlers::map]
fn graph_out(flows: VaultFlows) -> Result<EntityChanges, Error> {
    let mut tables = Tables::new();

    for deposit in flows.deposits {
        let id = format!("{}-{}", deposit.tx_hash, deposit.log_index);
        tables
            .create_row("VaultDeposit", &id)
            .set("vault", &deposit.vault)
            .set("sender", &deposit.sender)
            .set("owner", &deposit.owner)
            .set_bigint("assets", &decimal_string(deposit.assets))
            .set_bigint("shares", &decimal_string(deposit.shares))
            .set("txHash", &deposit.tx_hash)
            .set("blockNumber", deposit.block_number)
            .set("blockTimestamp", deposit.block_timestamp)
            .set("logIndex", deposit.log_index);
    }

    for withdraw in flows.withdraws {
        let id = format!("{}-{}", withdraw.tx_hash, withdraw.log_index);
        tables
            .create_row("VaultWithdraw", &id)
            .set("vault", &withdraw.vault)
            .set("sender", &withdraw.sender)
            .set("receiver", &withdraw.receiver)
            .set("owner", &withdraw.owner)
            .set_bigint("assets", &decimal_string(withdraw.assets))
            .set_bigint("shares", &decimal_string(withdraw.shares))
            .set("txHash", &withdraw.tx_hash)
            .set("blockNumber", withdraw.block_number)
            .set("blockTimestamp", withdraw.block_timestamp)
            .set("logIndex", withdraw.log_index);
    }

    Ok(tables.to_entity_changes())
}

/// Our own `BigInt` is raw big-endian bytes (see `erc4626.proto`'s own
/// rationale) — `Row::set_bigint` wants a decimal string instead, so this is
/// the one conversion point between the two representations. `BigUint`
/// rather than hand-rolled repeated division: correctness for an arbitrary-
/// width integer is exactly the kind of thing not worth re-deriving badly.
fn decimal_string(value: Option<RawBigInt>) -> String {
    match value {
        Some(v) => num_bigint::BigUint::from_bytes_be(&v.bytes).to_string(),
        None => "0".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_raw_bytes_as_a_decimal_string() {
        assert_eq!(
            decimal_string(Some(RawBigInt {
                bytes: vec![0x05, 0xF5, 0xE1, 0x00]
            })),
            "100000000"
        );
    }

    #[test]
    fn renders_a_single_zero_byte_as_zero() {
        assert_eq!(decimal_string(Some(RawBigInt { bytes: vec![0] })), "0");
    }

    #[test]
    fn renders_an_absent_amount_as_zero_rather_than_panicking() {
        // The protobuf field is optional; a well-formed VaultFlows always
        // sets it (see abi.rs), but a consumer parsing this package's output
        // independently might not guarantee that, and this must degrade
        // safely rather than unwrap into a crash.
        assert_eq!(decimal_string(None), "0");
    }

    #[test]
    fn round_trips_the_real_deposit_amount_from_arcaidias_own_vault() {
        // Same value the abi.rs real-fixture test verifies is decoded
        // correctly from the raw log in the first place — this test only
        // covers the second half: rendering it for the subgraph.
        assert_eq!(
            decimal_string(Some(RawBigInt {
                bytes: vec![0x05, 0xF5, 0xE1, 0x00]
            })),
            "100000000"
        );
        assert_eq!(
            decimal_string(Some(RawBigInt {
                bytes: vec![0x5A, 0xF3, 0x10, 0x7A, 0x40, 0x00]
            })),
            "100000000000000"
        );
    }
}
