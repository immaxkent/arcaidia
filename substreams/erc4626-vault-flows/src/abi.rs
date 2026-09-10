//! Raw EIP-4626 event decoding.
//!
//! Hand-decoded against the topic0/ABI layout directly, rather than generated
//! from one contract's ABI JSON (`substreams_ethereum::Abigen`) — that would
//! tie this module to one project's artifact. The standard's event
//! signatures are the only input; any conforming vault decodes identically.
//!
//! `event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)`
//! `event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)`

use crate::pb::erc4626::v1::BigInt;
use substreams_ethereum::pb::eth::v2::Log;

/// keccak256("Deposit(address,address,uint256,uint256)")
pub const DEPOSIT_TOPIC0: [u8; 32] =
    hex_literal::hex!("dcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7");

/// keccak256("Withdraw(address,address,address,uint256,uint256)")
pub const WITHDRAW_TOPIC0: [u8; 32] =
    hex_literal::hex!("fbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db");

#[derive(Debug, PartialEq)]
pub struct DecodedDeposit {
    pub sender: String,
    pub owner: String,
    pub assets: BigInt,
    pub shares: BigInt,
}

#[derive(Debug, PartialEq)]
pub struct DecodedWithdraw {
    pub sender: String,
    pub receiver: String,
    pub owner: String,
    pub assets: BigInt,
    pub shares: BigInt,
}

/// `None` = this log isn't a Deposit at all (topic0 doesn't match).
/// `Some(None)` = it matched, but the log is malformed (wrong topic/data
/// length) — skip it, never let one bad log fail the whole block.
pub fn decode_deposit(log: &Log) -> Option<Option<DecodedDeposit>> {
    if log.topics.first().map(|t| t.as_slice()) != Some(&DEPOSIT_TOPIC0[..]) {
        return None;
    }
    Some((|| {
        if log.topics.len() != 3 || log.data.len() != 64 {
            return None;
        }
        Some(DecodedDeposit {
            sender: address_from_topic(&log.topics[1])?,
            owner: address_from_topic(&log.topics[2])?,
            assets: word_to_bigint(&log.data[0..32]),
            shares: word_to_bigint(&log.data[32..64]),
        })
    })())
}

pub fn decode_withdraw(log: &Log) -> Option<Option<DecodedWithdraw>> {
    if log.topics.first().map(|t| t.as_slice()) != Some(&WITHDRAW_TOPIC0[..]) {
        return None;
    }
    Some((|| {
        if log.topics.len() != 4 || log.data.len() != 64 {
            return None;
        }
        Some(DecodedWithdraw {
            sender: address_from_topic(&log.topics[1])?,
            receiver: address_from_topic(&log.topics[2])?,
            owner: address_from_topic(&log.topics[3])?,
            assets: word_to_bigint(&log.data[0..32]),
            shares: word_to_bigint(&log.data[32..64]),
        })
    })())
}

/// A topic word is 32 bytes; an indexed `address` occupies the low 20 bytes,
/// left-padded with zeros. `None` if the padding isn't actually zero — a
/// malformed or non-address topic, not a real address.
fn address_from_topic(topic: &[u8]) -> Option<String> {
    if topic.len() != 32 || topic[0..12].iter().any(|b| *b != 0) {
        return None;
    }
    Some(format!("0x{}", hex::encode(&topic[12..32])))
}

/// Big-endian 32-byte ABI word -> our BigInt, with leading zero bytes
/// trimmed so a small value doesn't carry 32 bytes of padding — canonical
/// bignum-byte-string form, matching how most consumers expect to receive it.
fn word_to_bigint(word: &[u8]) -> BigInt {
    let first_nonzero = word.iter().position(|b| *b != 0);
    let trimmed = match first_nonzero {
        Some(i) => &word[i..],
        None => &word[31..], // all-zero word -> a single 0x00 byte, not empty
    };
    BigInt {
        bytes: trimmed.to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn topic_addr(addr_hex: &str) -> Vec<u8> {
        let addr = hex::decode(addr_hex).unwrap();
        assert_eq!(addr.len(), 20);
        let mut topic = vec![0u8; 12];
        topic.extend_from_slice(&addr);
        topic
    }

    fn word_u64(v: u64) -> Vec<u8> {
        let mut word = vec![0u8; 32];
        word[24..32].copy_from_slice(&v.to_be_bytes());
        word
    }

    fn deposit_log(sender: &str, owner: &str, assets: u64, shares: u64) -> Log {
        let mut data = word_u64(assets);
        data.extend_from_slice(&word_u64(shares));
        Log {
            address: hex::decode("aaaa000000000000000000000000000000000001").unwrap(),
            topics: vec![
                DEPOSIT_TOPIC0.to_vec(),
                topic_addr(sender),
                topic_addr(owner),
            ],
            data,
            index: 0,
            block_index: 0,
            ordinal: 0,
        }
    }

    fn withdraw_log(sender: &str, receiver: &str, owner: &str, assets: u64, shares: u64) -> Log {
        let mut data = word_u64(assets);
        data.extend_from_slice(&word_u64(shares));
        Log {
            address: hex::decode("aaaa000000000000000000000000000000000001").unwrap(),
            topics: vec![
                WITHDRAW_TOPIC0.to_vec(),
                topic_addr(sender),
                topic_addr(receiver),
                topic_addr(owner),
            ],
            data,
            index: 0,
            block_index: 0,
            ordinal: 0,
        }
    }

    const SENDER: &str = "1111111111111111111111111111111111111111";
    const OWNER: &str = "2222222222222222222222222222222222222222";
    const RECEIVER: &str = "3333333333333333333333333333333333333333";

    #[test]
    fn decodes_a_well_formed_deposit() {
        let log = deposit_log(SENDER, OWNER, 1_000_000, 999_000);
        let decoded = decode_deposit(&log).flatten().expect("should decode");
        assert_eq!(decoded.sender, format!("0x{SENDER}"));
        assert_eq!(decoded.owner, format!("0x{OWNER}"));
        // 1_000_000 = 0x0F4240, 999_000 = 0x0F3E58 — minimal big-endian bytes,
        // not a slice of to_be_bytes() at a guessed offset (easy to miscount).
        assert_eq!(decoded.assets.bytes, vec![0x0F, 0x42, 0x40]);
        assert_eq!(decoded.shares.bytes, vec![0x0F, 0x3E, 0x58]);
    }

    #[test]
    fn decodes_a_well_formed_withdraw() {
        let log = withdraw_log(SENDER, RECEIVER, OWNER, 500_000, 480_000);
        let decoded = decode_withdraw(&log).flatten().expect("should decode");
        assert_eq!(decoded.sender, format!("0x{SENDER}"));
        assert_eq!(decoded.receiver, format!("0x{RECEIVER}"));
        assert_eq!(decoded.owner, format!("0x{OWNER}"));
    }

    #[test]
    fn ignores_a_log_from_an_unrelated_event() {
        let mut log = deposit_log(SENDER, OWNER, 1, 1);
        log.topics[0] = vec![0xff; 32]; // some other event entirely
        assert!(decode_deposit(&log).is_none());
        assert!(decode_withdraw(&log).is_none());
    }

    #[test]
    fn a_deposit_never_matches_as_a_withdraw_and_vice_versa() {
        let deposit = deposit_log(SENDER, OWNER, 1, 1);
        assert!(decode_withdraw(&deposit).is_none());

        let withdraw = withdraw_log(SENDER, RECEIVER, OWNER, 1, 1);
        assert!(decode_deposit(&withdraw).is_none());
    }

    /// A real vault never emits this, but a decoder that panics on it takes
    /// down the entire block's indexing over one bad log — it must degrade
    /// to "skip this log" instead.
    #[test]
    fn a_matching_topic0_with_wrong_topic_count_does_not_panic() {
        let mut log = deposit_log(SENDER, OWNER, 1, 1);
        log.topics.pop(); // now only 2 topics instead of the required 3

        assert_eq!(decode_deposit(&log), Some(None));
    }

    #[test]
    fn a_matching_topic0_with_wrong_data_length_does_not_panic() {
        let mut log = deposit_log(SENDER, OWNER, 1, 1);
        log.data.truncate(32); // only one word instead of the required two

        assert_eq!(decode_deposit(&log), Some(None));
    }

    #[test]
    fn a_topic_whose_left_padding_is_not_actually_zero_is_not_treated_as_an_address() {
        // Malformed input, not a real EVM log — a well-formed indexed address
        // topic is always zero-padded. A decoder that silently truncated it
        // to the low 20 bytes anyway would fabricate an address that was
        // never actually emitted.
        let mut log = deposit_log(SENDER, OWNER, 1, 1);
        log.topics[1][0] = 0x01;

        assert_eq!(decode_deposit(&log), Some(None));
    }

    #[test]
    fn trims_leading_zero_bytes_from_the_amount() {
        let log = deposit_log(SENDER, OWNER, 42, 0);
        let decoded = decode_deposit(&log).flatten().unwrap();
        assert_eq!(decoded.assets.bytes, vec![42]);
        // Zero itself trims to a single zero byte, never an empty vector —
        // an empty byte string is ambiguous with "field absent" in most
        // consumers' bignum decoders, whereas a lone 0x00 is unambiguously zero.
        assert_eq!(decoded.shares.bytes, vec![0]);
    }

    #[test]
    fn does_not_hardcode_or_special_case_any_particular_vault_address() {
        // The genericness bar from WP-ERC4626-SUBSTREAMS.md §2: decoding must
        // depend only on the event signature, never on which address emitted it.
        let mut log = deposit_log(SENDER, OWNER, 1, 1);
        log.address = hex::decode("dead00000000000000000000000000000000ff").unwrap();
        assert!(decode_deposit(&log).flatten().is_some());
    }

    /// WP-ERC4626-SUBSTREAMS.md §5.3 — not a synthetic fixture: this is the
    /// exact topics/data of a real `Deposit` log, fetched live via
    /// `cast logs` against Arcaidia's actual deployed vault on Ethereum
    /// Sepolia (`0xc74E693938DfBf7c11b787bA27cddE4c0215AAF1`,
    /// tx `0x03aba6621279c69d4ad41aa5e23d5cf6d8bf2f42ba8ab9be9f67015117f6bf51`,
    /// block 11675763). Ground truth for `assets`/`shares` cross-checked
    /// independently against the vault's own `totalSupply()` (1e14) via
    /// `cast call` earlier this session, not derived from this decoder.
    ///
    /// Live Substreams auth (`substreams run` against a real Firehose
    /// endpoint) needs an API key only the account owner can create — not
    /// attempted here. This is the verification that's actually reachable
    /// without it: the same decoding logic the wasm module runs, exercised
    /// against a real chain event instead of a hand-built one.
    #[test]
    fn decodes_a_real_deposit_log_from_arcaidias_own_sepolia_vault() {
        let log = Log {
            address: hex::decode("c74e693938dfbf7c11b787ba27cdde4c0215aaf1").unwrap(),
            topics: vec![
                DEPOSIT_TOPIC0.to_vec(),
                hex::decode("000000000000000000000000538e5e9797fa86ee25e97289439b6a3aba0165b0")
                    .unwrap(),
                hex::decode("000000000000000000000000538e5e9797fa86ee25e97289439b6a3aba0165b0")
                    .unwrap(),
            ],
            data: hex::decode(concat!(
                "0000000000000000000000000000000000000000000000000000000005f5e100",
                "00000000000000000000000000000000000000000000000000005af3107a4000",
            ))
            .unwrap(),
            index: 0x8c,
            block_index: 0,
            ordinal: 0,
        };

        let decoded = decode_deposit(&log)
            .flatten()
            .expect("a real vault deposit must decode");

        assert_eq!(decoded.sender, "0x538e5e9797fa86ee25e97289439b6a3aba0165b0");
        assert_eq!(decoded.owner, "0x538e5e9797fa86ee25e97289439b6a3aba0165b0");
        // 100_000_000 (100 USDC at 6 decimals) — the real $100 test deposit
        // from earlier this session, not a round number chosen for the
        // test. Minimal big-endian bytes computed independently in Python,
        // not sliced from to_be_bytes() at a hand-counted offset — that
        // exact mistake bit an earlier test in this same file.
        assert_eq!(decoded.assets.bytes, vec![0x05, 0xF5, 0xE1, 0x00]);
        // 100_000_000_000_000 — matches totalSupply() read live via `cast
        // call` against the real vault (single depositor, so its whole
        // supply is this one deposit's shares).
        assert_eq!(
            decoded.shares.bytes,
            vec![0x5A, 0xF3, 0x10, 0x7A, 0x40, 0x00]
        );
    }
}
