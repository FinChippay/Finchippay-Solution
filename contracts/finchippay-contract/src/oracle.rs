//! # Price Oracle Interface — LP Share Valuation
//!
//! Defines the on-chain price oracle interface that [`crate::yield_escrow`]
//! uses to value LP shares in the pool's base token. A production deployment
//! points `oracle_address` at a live Stellar/Soroban price oracle (e.g.
//! Reflector — https://reflector.network, or Band Protocol); tests point it
//! at [`test_support::MockPriceOracle`] below.
//!
//! Any contract exposing a `get_price(pool: Address) -> PriceData` function
//! with this signature can serve as an oracle — [`PriceOracleClient`] calls
//! it by name via the standard Soroban cross-contract invocation, so no
//! shared Rust trait implementation is required between this contract and
//! the oracle. See `tests/yield_escrow_oracle.rs` for a minimal mock oracle
//! contract used to exercise this interface.
//!
//! ## Staleness
//!
//! [`get_share_price`] rejects any quote older than [`MAX_ORACLE_AGE`]
//! ledgers (and any quote timestamped in the future), so a stalled or
//! compromised oracle can't be used to mis-value shares.
//!
//! ## Full AMM integration
//!
//! This module only defines the oracle interface and price-lookup helper.
//! Depositing into / withdrawing from a real AMM pool is tracked separately
//! (see `yield_escrow.rs`'s module docs).

use soroban_sdk::{contractclient, contracttype, Address, Env};

/// Fixed-point scale for oracle prices (7 decimal places, matching common
/// Stellar/Soroban oracle conventions, e.g. Reflector's fiat/stablecoin feeds).
/// A `price` of `PRICE_SCALE` means 1 LP share is worth exactly 1 base-token unit.
pub const PRICE_SCALE: i128 = 10_000_000;

/// Maximum age (in ledgers) a price quote may have before it is rejected as
/// stale (~10 minutes at 5s/ledger).
pub const MAX_ORACLE_AGE: u32 = 120;

/// A single price quote for an LP pool's share value.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceData {
    /// Value of one LP share in base-token units, scaled by [`PRICE_SCALE`].
    pub price: i128,
    /// Ledger sequence at which this price was last updated.
    pub ledger: u32,
}

/// Interface any on-chain price oracle must expose. [`PriceOracleClient`] is
/// the generated client used to call an oracle contract by address.
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleInterface {
    /// Return the current price of one LP share of `pool`, in base-token
    /// units scaled by [`PRICE_SCALE`].
    fn get_price(env: Env, pool: Address) -> PriceData;
}

/// Query `oracle` for the current share price of `pool`, enforcing staleness
/// and sanity checks. Returns the price in base-token units per share,
/// scaled by [`PRICE_SCALE`].
///
/// # Panics
/// - If the oracle reports a non-positive price.
/// - If the oracle's quote is older than [`MAX_ORACLE_AGE`] ledgers.
/// - If the oracle's quote is timestamped in the future (a misbehaving or
///   malicious oracle).
pub fn get_share_price(env: &Env, pool: &Address, oracle: &Address) -> i128 {
    let client = PriceOracleClient::new(env, oracle);
    let data = client.get_price(pool);

    if data.price <= 0 {
        panic!("Oracle price must be positive");
    }

    let current_ledger = env.ledger().sequence();
    if data.ledger > current_ledger {
        panic!("Oracle price is from the future");
    }
    if current_ledger - data.ledger > MAX_ORACLE_AGE {
        panic!("Oracle price is stale");
    }

    data.price
}
