#![cfg(test)]

//! Formal Property-Based Testing Harness for `claimable_at` Streaming Arithmetic
//! & Streaming Payment Finite-State Machine.
//!
//! Verifies 8 core invariants + state-machine lifecycle consistency using `proptest`.

use finchippay_contract::{
    claimable_at, Stream, MAX_STREAM_DEPOSIT, MAX_STREAM_RATE,
};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

/// Minimum number of cases required per invariant.
const CASES_INVARIANT: u32 = 10_000;
/// Minimum number of sequences for state machine testing.
const CASES_STATE_MACHINE: u32 = 1_000;

fn stream_strategy() -> impl Strategy<Value = Stream> {
    (
        0u32..=u32::MAX,
        0i128..=MAX_STREAM_RATE,
        0i128..=MAX_STREAM_DEPOSIT,
        0i128..=MAX_STREAM_DEPOSIT,
        0u32..=(u32::MAX / 2),
        0u32..=(u32::MAX / 2),
        0u32..=1_000_000u32,
        any::<bool>(),
    )
        .prop_map(
            |(id, rate, deposit, claimed_raw, start, paused_at, total_paused, closed)| {
                let env = Env::default();
                let payer = Address::generate(&env);
                let recipient = Address::generate(&env);
                let token = Address::generate(&env);
                let claimed = claimed_raw.min(deposit);
                Stream {
                    id,
                    payer,
                    recipient,
                    token,
                    rate_per_ledger: rate,
                    deposited: deposit,
                    claimed,
                    start_ledger: start,
                    closed,
                    paused_at_ledger: paused_at,
                    total_paused_duration: total_paused,
                }
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES_INVARIANT))]

    /// Invariant 1: `claimable_at(s, ledger) >= 0` for all `(s, ledger)`.
    #[test]
    fn i1_claimable_is_never_negative(stream in stream_strategy(), ledger in 0u32..=u32::MAX) {
        let claimable = claimable_at(&stream, ledger);
        prop_assert!(claimable >= 0, "claimable_at returned negative: {}", claimable);
    }

    /// Invariant 2: `claimable_at(s, ledger) <= stream.deposited - stream.claimed`.
    #[test]
    fn i2_claimable_never_exceeds_remaining_deposit(stream in stream_strategy(), ledger in 0u32..=u32::MAX) {
        let claimable = claimable_at(&stream, ledger);
        let remaining = stream.deposited.saturating_sub(stream.claimed);
        prop_assert!(
            claimable <= remaining,
            "claimable {} > remaining deposit {}",
            claimable,
            remaining
        );
    }

    /// Invariant 3: If `stream.closed`, `claimable_at(stream, *) == 0`.
    #[test]
    fn i3_closed_stream_claimable_is_zero(mut stream in stream_strategy(), ledger in 0u32..=u32::MAX) {
        stream.closed = true;
        let claimable = claimable_at(&stream, ledger);
        prop_assert_eq!(claimable, 0, "closed stream returned non-zero claimable: {}", claimable);
    }

    /// Invariant 4: If `ledger <= stream.start_ledger`, `claimable_at(stream, ledger) == 0`.
    #[test]
    fn i4_before_start_ledger_claimable_is_zero(stream in stream_strategy(), delta in 0u32..=1_000_000u32) {
        let ledger = stream.start_ledger.saturating_sub(delta);
        let claimable = claimable_at(&stream, ledger);
        prop_assert_eq!(
            claimable,
            0,
            "claimable prior to/at start ledger {} is non-zero: {}",
            stream.start_ledger,
            claimable
        );
    }

    /// Invariant 5: If `stream.rate_per_ledger == 0`, `claimable_at(stream, *) == 0`.
    #[test]
    fn i5_zero_rate_claimable_is_zero(mut stream in stream_strategy(), ledger in 0u32..=u32::MAX) {
        stream.rate_per_ledger = 0;
        let claimable = claimable_at(&stream, ledger);
        prop_assert_eq!(claimable, 0, "zero-rate stream returned claimable: {}", claimable);
    }

    /// Invariant 6: `claimable_at` is time-monotonic when not paused/closed (`ledger2 >= ledger1`).
    #[test]
    fn i6_monotonic_without_pause_or_close(
        mut stream in stream_strategy(),
        l1 in 0u32..=(u32::MAX / 2),
        delta in 0u32..=10_000_000u32,
    ) {
        stream.closed = false;
        stream.paused_at_ledger = 0;
        let l2 = l1.saturating_add(delta);

        let c1 = claimable_at(&stream, l1);
        let c2 = claimable_at(&stream, l2);
        prop_assert!(
            c2 >= c1,
            "non-monotonic claimable growth: c1={} at l1={}, c2={} at l2={}",
            c1,
            l1,
            c2,
            l2
        );
    }

    /// Invariant 7: Pausing for N ledgers stops claimable accumulation during active pause.
    #[test]
    fn i7_pause_freezes_claimable_growth(
        mut stream in stream_strategy(),
        pause_ledger in 1u32..=1_000_000u32,
        advance in 1u32..=100_000u32,
    ) {
        stream.closed = false;
        stream.start_ledger = 0;
        stream.paused_at_ledger = pause_ledger;

        let at_pause = claimable_at(&stream, pause_ledger);
        let after_pause = claimable_at(&stream, pause_ledger.saturating_add(advance));

        prop_assert_eq!(
            at_pause,
            after_pause,
            "claimable changed during active pause: at_pause={}, after_pause={}",
            at_pause,
            after_pause
        );
    }

    /// Invariant 8: `stream.claimed + claimable_at(stream, ledger) <= stream.deposited`.
    #[test]
    fn i8_round_trip_total_claimed_never_exceeds_deposit(stream in stream_strategy(), ledger in 0u32..=u32::MAX) {
        let claimable = claimable_at(&stream, ledger);
        let total_out = stream.claimed.saturating_add(claimable);
        prop_assert!(
            total_out <= stream.deposited,
            "total claimed + claimable {} > deposited {}",
            total_out,
            stream.deposited
        );
    }
}

// ─── State Machine Lifecycle Property Test ──────────────────────────────────

#[derive(Clone, Debug)]
enum StreamAction {
    Claim(i128),
    TopUp(i128),
    Pause,
    Resume,
    Close,
    AdvanceLedgers(u32),
}

fn action_strategy() -> impl Strategy<Value = StreamAction> {
    prop_oneof![
        (1i128..=1_000_000_000i128).prop_map(StreamAction::Claim),
        (1i128..=10_000_000_000i128).prop_map(StreamAction::TopUp),
        Just(StreamAction::Pause),
        Just(StreamAction::Resume),
        Just(StreamAction::Close),
        (1u32..=10_000u32).prop_map(StreamAction::AdvanceLedgers),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES_STATE_MACHINE))]

    /// State Machine Invariant: For any sequence of lifecycle actions,
    /// `claimed <= deposited` and total funds out never exceed total funds in.
    #[test]
    fn state_machine_streaming_lifecycle(
        rate in 1i128..=MAX_STREAM_RATE,
        initial_deposit in 1i128..=100_000_000_000i128,
        actions in proptest::collection::vec(action_strategy(), 1..50),
    ) {
        let env = Env::default();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        let token = Address::generate(&env);

        let mut stream = Stream {
            id: 1,
            payer,
            recipient,
            token,
            rate_per_ledger: rate,
            deposited: initial_deposit,
            claimed: 0,
            start_ledger: 100,
            closed: false,
            paused_at_ledger: 0,
            total_paused_duration: 0,
        };

        let mut current_ledger: u32 = 100;

        for action in actions {
            match action {
                StreamAction::AdvanceLedgers(delta) => {
                    current_ledger = current_ledger.saturating_add(delta);
                }
                StreamAction::Claim(desired) => {
                    let available = claimable_at(&stream, current_ledger);
                    let to_claim = desired.min(available);
                    if to_claim > 0 {
                        stream.claimed = stream.claimed.saturating_add(to_claim);
                    }
                }
                StreamAction::TopUp(amount) => {
                    if !stream.closed {
                        stream.deposited = stream.deposited.saturating_add(amount).min(MAX_STREAM_DEPOSIT);
                    }
                }
                StreamAction::Pause => {
                    if !stream.closed && stream.paused_at_ledger == 0 {
                        stream.paused_at_ledger = current_ledger;
                    }
                }
                StreamAction::Resume => {
                    if !stream.closed && stream.paused_at_ledger > 0 {
                        let duration = current_ledger.saturating_sub(stream.paused_at_ledger);
                        stream.total_paused_duration = stream.total_paused_duration.saturating_add(duration);
                        stream.paused_at_ledger = 0;
                    }
                }
                StreamAction::Close => {
                    if !stream.closed {
                        let claimable = claimable_at(&stream, current_ledger);
                        stream.claimed = stream.claimed.saturating_add(claimable);
                        stream.closed = true;
                    }
                }
            }

            // Verify state invariants after every step
            prop_assert!(stream.claimed <= stream.deposited, "claimed {} > deposited {}", stream.claimed, stream.deposited);
            let claimable_now = claimable_at(&stream, current_ledger);
            prop_assert!(claimable_now >= 0, "negative claimable: {}", claimable_now);
            prop_assert!(
                stream.claimed.saturating_add(claimable_now) <= stream.deposited,
                "total claimed + claimable exceeds deposited"
            );
        }
    }
}
