//! Turns `VaultFlows` into `EntityChanges` — the shape a
//! `substreams/graph-entities` subgraph data source expects its module to
//! emit directly (see `vault-flows-subgraph/subgraph.yaml`).
//!
//! Built against our own vendored `proto/sf/substreams/sink/entity/v1/entity.proto`
//! rather than the `substreams-entity-change` crate: that crate pins a
//! `substreams` version that collides with ours at wasm-link time
//! (`Linking globals named 'alloc': symbol multiply defined!`) — a failure
//! `cargo test`/`cargo check` never surface since it's specific to the wasm
//! target. The schema itself has no such constraint; only the crate's own
//! helper library does.
//!
//! Kept as its own module, downstream of `map_vault_flows` rather than
//! folded into it: `map_vault_flows`'s output (`VaultFlows`) is the generic,
//! reusable artifact — usable by anyone consuming this package directly,
//! Graph-entity subgraph or not. `graph_out` is one specific *consumer* of
//! that output, not part of the generic contract itself.

use crate::pb::erc4626::v1::{BigInt as RawBigInt, VaultFlows};
use crate::pb::sf::substreams::sink::entity::v1::entity_change::Operation;
use crate::pb::sf::substreams::sink::entity::v1::value::Typed;
use crate::pb::sf::substreams::sink::entity::v1::{EntityChange, EntityChanges, Field, Value};
use substreams::errors::Error;

#[substreams::handlers::map]
fn graph_out(flows: VaultFlows) -> Result<EntityChanges, Error> {
    Ok(build_entity_changes(flows))
}

/// The actual logic, as a plain function — same split as `map_vault_flows`
/// / `abi::decode_deposit`. `#[substreams::handlers::map]` rewrites its
/// function's signature to the wasm host-call ABI (raw pointers, not Rust
/// types), so the macro-wrapped `graph_out` itself isn't callable like an
/// ordinary function from a test; this is.
fn build_entity_changes(flows: VaultFlows) -> EntityChanges {
    let mut entity_changes = Vec::new();

    for deposit in flows.deposits {
        entity_changes.push(entity_change(
            "VaultDeposit",
            &format!("{}-{}", deposit.tx_hash, deposit.log_index),
            vec![
                bytes_field("vault", &deposit.vault),
                bytes_field("sender", &deposit.sender),
                bytes_field("owner", &deposit.owner),
                bigint_field("assets", deposit.assets),
                bigint_field("shares", deposit.shares),
                bytes_field("txHash", &deposit.tx_hash),
                bigint_field_u64("blockNumber", deposit.block_number),
                bigint_field_u64("blockTimestamp", deposit.block_timestamp),
                bigint_field_u32("logIndex", deposit.log_index),
            ],
        ));
    }

    for withdraw in flows.withdraws {
        entity_changes.push(entity_change(
            "VaultWithdraw",
            &format!("{}-{}", withdraw.tx_hash, withdraw.log_index),
            vec![
                bytes_field("vault", &withdraw.vault),
                bytes_field("sender", &withdraw.sender),
                bytes_field("receiver", &withdraw.receiver),
                bytes_field("owner", &withdraw.owner),
                bigint_field("assets", withdraw.assets),
                bigint_field("shares", withdraw.shares),
                bytes_field("txHash", &withdraw.tx_hash),
                bigint_field_u64("blockNumber", withdraw.block_number),
                bigint_field_u64("blockTimestamp", withdraw.block_timestamp),
                bigint_field_u32("logIndex", withdraw.log_index),
            ],
        ));
    }

    EntityChanges { entity_changes }
}

/// Every entity here is immutable (see `schema.graphql`) — a fill/deposit
/// event never gets amended after the fact — so every change is a create,
/// never update/delete. `ordinal` is 0 throughout: graph-node's own docs
/// mark it deprecated and unused, not a field worth threading real values
/// through.
fn entity_change(entity: &str, id: &str, fields: Vec<Field>) -> EntityChange {
    EntityChange {
        entity: entity.to_string(),
        id: id.to_string(),
        ordinal: 0,
        operation: Operation::Create as i32,
        fields,
    }
}

fn value(typed: Typed) -> Option<Value> {
    Some(Value { typed: Some(typed) })
}

/// Matches `schema.graphql`'s `Bytes!` fields (addresses, hashes) — the
/// entity-change schema represents these as its own `bytes` variant, which
/// is itself a string despite the name (an upstream convention, not ours;
/// preserved as-is since graph-node is the actual reader of this field).
fn bytes_field(name: &str, hex_str: &str) -> Field {
    Field {
        name: name.to_string(),
        new_value: value(Typed::Bytes(hex_str.to_string())),
        old_value: None,
    }
}

/// Matches `schema.graphql`'s `BigInt!` fields backed by our own raw-bytes
/// `RawBigInt` — rendered as a decimal string, which is what the `bigint`
/// variant actually carries on the wire (see entity.proto).
fn bigint_field(name: &str, raw: Option<RawBigInt>) -> Field {
    let decimal = match raw {
        Some(v) => num_bigint::BigUint::from_bytes_be(&v.bytes).to_string(),
        None => "0".to_string(),
    };
    Field {
        name: name.to_string(),
        new_value: value(Typed::Bigint(decimal)),
        old_value: None,
    }
}

/// Block number / timestamp are plain `u64`s from `map_vault_flows`, not our
/// `RawBigInt` — schema.graphql still types them `BigInt!` (graph-node has
/// no native u64 scalar), so the wire representation is the same decimal
/// string, just built from a primitive instead of raw bytes.
fn bigint_field_u64(name: &str, v: u64) -> Field {
    Field {
        name: name.to_string(),
        new_value: value(Typed::Bigint(v.to_string())),
        old_value: None,
    }
}

fn bigint_field_u32(name: &str, v: u32) -> Field {
    Field {
        name: name.to_string(),
        new_value: value(Typed::Bigint(v.to_string())),
        old_value: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_field<'a>(fields: &'a [Field], name: &str) -> &'a Value {
        fields
            .iter()
            .find(|f| f.name == name)
            .unwrap_or_else(|| panic!("no field named {name}"))
            .new_value
            .as_ref()
            .unwrap_or_else(|| panic!("field {name} has no new_value"))
    }

    fn bigint_of(v: &Value) -> &str {
        match &v.typed {
            Some(Typed::Bigint(s)) => s,
            other => panic!("expected Bigint, got {other:?}"),
        }
    }

    fn bytes_of(v: &Value) -> &str {
        match &v.typed {
            Some(Typed::Bytes(s)) => s,
            other => panic!("expected Bytes, got {other:?}"),
        }
    }

    #[test]
    fn a_deposit_becomes_a_single_create_entity_change() {
        let flows = VaultFlows {
            deposits: vec![crate::pb::erc4626::v1::Deposit {
                vault: "0xaaaa".to_string(),
                sender: "0x1111".to_string(),
                owner: "0x2222".to_string(),
                assets: Some(RawBigInt {
                    bytes: vec![0x05, 0xF5, 0xE1, 0x00],
                }),
                shares: Some(RawBigInt { bytes: vec![0x2A] }),
                tx_hash: "0xdead".to_string(),
                block_number: 11675763,
                block_timestamp: 1_800_000_000,
                log_index: 140,
            }],
            withdraws: vec![],
        };

        let out = build_entity_changes(flows);
        assert_eq!(out.entity_changes.len(), 1);

        let change = &out.entity_changes[0];
        assert_eq!(change.entity, "VaultDeposit");
        assert_eq!(change.id, "0xdead-140");
        assert_eq!(change.operation, Operation::Create as i32);

        assert_eq!(bytes_of(find_field(&change.fields, "vault")), "0xaaaa");
        assert_eq!(bytes_of(find_field(&change.fields, "sender")), "0x1111");
        assert_eq!(bigint_of(find_field(&change.fields, "assets")), "100000000");
        assert_eq!(bigint_of(find_field(&change.fields, "shares")), "42");
        assert_eq!(
            bigint_of(find_field(&change.fields, "blockNumber")),
            "11675763"
        );
        assert_eq!(bigint_of(find_field(&change.fields, "logIndex")), "140");
    }

    #[test]
    fn a_withdraw_becomes_a_vault_withdraw_entity_with_a_receiver_field() {
        let flows = VaultFlows {
            deposits: vec![],
            withdraws: vec![crate::pb::erc4626::v1::Withdraw {
                vault: "0xaaaa".to_string(),
                sender: "0x1111".to_string(),
                receiver: "0x3333".to_string(),
                owner: "0x2222".to_string(),
                assets: Some(RawBigInt { bytes: vec![1] }),
                shares: Some(RawBigInt { bytes: vec![1] }),
                tx_hash: "0xbeef".to_string(),
                block_number: 1,
                block_timestamp: 1,
                log_index: 0,
            }],
        };

        let out = build_entity_changes(flows);
        assert_eq!(out.entity_changes[0].entity, "VaultWithdraw");
        assert_eq!(
            bytes_of(find_field(&out.entity_changes[0].fields, "receiver")),
            "0x3333"
        );
    }

    #[test]
    fn an_empty_block_produces_no_entity_changes() {
        let out = build_entity_changes(VaultFlows {
            deposits: vec![],
            withdraws: vec![],
        });
        assert!(out.entity_changes.is_empty());
    }

    #[test]
    fn a_missing_amount_renders_as_zero_rather_than_panicking() {
        let flows = VaultFlows {
            deposits: vec![crate::pb::erc4626::v1::Deposit {
                vault: "0xaaaa".to_string(),
                sender: "0x1111".to_string(),
                owner: "0x2222".to_string(),
                assets: None,
                shares: None,
                tx_hash: "0xdead".to_string(),
                block_number: 1,
                block_timestamp: 1,
                log_index: 0,
            }],
            withdraws: vec![],
        };

        let out = build_entity_changes(flows);
        assert_eq!(
            bigint_of(find_field(&out.entity_changes[0].fields, "assets")),
            "0"
        );
    }
}
