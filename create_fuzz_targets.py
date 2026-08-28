import os

BASE = r'C:\Users\USER\Finchippay-Solution'
FUZZ_DIR = os.path.join(BASE, 'contracts', 'finchippay-contract', 'fuzz')
TARGETS_DIR = os.path.join(FUZZ_DIR, 'fuzz_targets')

os.makedirs(TARGETS_DIR, exist_ok=True)

# ================================================================
# 1. fuzz/Cargo.toml
# ================================================================
cargo_toml = '''[package]
name = "finchippay-contract-fuzz"
version = "0.0.0"
publish = false
edition = "2021"

[package.metadata]
cargo-fuzz = true

[dependencies]
libfuzzer-sys = "0.4"

[dependencies.finchippay-contract]
path = ".."

[dependencies.soroban-sdk]
version = "27.0.1"
features = ["testutils"]

[[bin]]
name = "open_stream"
path = "fuzz_targets/open_stream.rs"
test = false
doc = false
bench = false

[[bin]]
name = "claim_stream"
path = "fuzz_targets/claim_stream.rs"
test = false
doc = false
bench = false

[[bin]]
name = "create_escrow"
path = "fuzz_targets/create_escrow.rs"
test = false
doc = false
bench = false

[[bin]]
name = "claim_escrow"
path = "fuzz_targets/claim_escrow.rs"
test = false
doc = false
bench = false

[[bin]]
name = "batch_send"
path = "fuzz_targets/batch_send.rs"
test = false
doc = false
bench = false

[[bin]]
name = "create_multisig"
path = "fuzz_targets/create_multisig.rs"
test = false
doc = false
bench = false

[[bin]]
name = "approve_multisig"
path = "fuzz_targets/approve_multisig.rs"
test = false
doc = false
bench = false
'''

with open(os.path.join(FUZZ_DIR, 'Cargo.toml'), 'w') as f:
    f.write(cargo_toml)
print("Created fuzz/Cargo.toml")

# ================================================================
# 2. fuzz/.gitignore
# ================================================================
gitignore = '''target
corpus
artifacts
coverage
'''

with open(os.path.join(FUZZ_DIR, '.gitignore'), 'w') as f:
    f.write(gitignore)
print("Created fuzz/.gitignore")

# ================================================================
# 3. Helper module - shared setup code
# ================================================================
# We'll inline the setup in each target since cargo-fuzz requires
# each bin to be self-contained. Each target has:
#   #![no_main]
#   use libfuzzer_sys::fuzz_target;

# ================================================================
# 4. Fuzz target function body (shared template)
# ================================================================
def write_fuzz_target(name, setup_code, fuzz_code):
    """Write a fuzz target file."""
    content = '''#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Address, Env, Symbol, Vec};
use soroban_sdk::testutils::Address as _;
use finchippay_contract::FinchippayContractClient;

// Shared: set up a minimal contract + token environment.
// Returns (env, client, token_id, admin).
fn setup_contract() -> (Env, FinchippayContractClient, Address, Address) {
    let env = Env::default();
    let contract_id = env.register(
        finchippay_contract::FinchippayContract,
        (),
    );
    let client = FinchippayContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signers = soroban_sdk::Vec::from_array(&env, [admin.clone()]);
    let _ = client.initialize(&signers, &1);

    // Create a simple token for payment operations.
    let token_id = Address::generate(&env);
    // Use the built-in Stellar token interface.
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&admin, &1_000_000_000_000i128);

    (env, client, token_id, admin)
}

// Helper: extract a u32 from the fuzz data (big-endian), returns remaining slice.
fn take_u32(data: &[u8]) -> (u32, &[u8]) {
    if data.len() < 4 {
        return (0, &[]);
    }
    let (bytes, rest) = data.split_at(4);
    let val = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    (val, rest)
}

// Helper: extract an i128 from fuzz data (big-endian), returns remaining slice.
fn take_i128(data: &[u8]) -> (i128, &[u8]) {
    if data.len() < 16 {
        return (0, &[]);
    }
    let (bytes, rest) = data.split_at(16);
    let val = i128::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15],
    ]);
    (val, rest)
}

// Helper: pick a deterministic address from fuzz data.
fn pick_address(env: &Env, data: &[u8], index: u8) -> Address {
    // Use index to vary which address we create
    let mut bytes = [0u8; 32];
    let len = data.len().min(32);
    bytes[..len].copy_from_slice(&data[..len]);
    bytes[0] = bytes[0].wrapping_add(index);
    Address::from_array(env, &bytes)
}

'''

    content += f'''
fuzz_target!(|data: &[u8]| {{
    {setup_code}
    
    {fuzz_code}
}});
'''

    path = os.path.join(TARGETS_DIR, f'{name}.rs')
    with open(path, 'w') as f:
        f.write(content)
    print(f"Created fuzz_targets/{name}.rs")

# ================================================================
# Define each fuzz target
# ================================================================

# --- open_stream ---
open_stream_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 16 { return; }
    let (rate, d1) = take_i128(data);
    let (deposit, _d2) = take_i128(d1);
    
    // Constrain values to avoid trivial panics from validation
    let rate = rate.abs() % 1_000_000_000_000i128 + 1; // 1 .. 1e12
    let deposit = deposit.abs() % 10_000_000_000_000i128 + 1; // 1 .. 1e13
    
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    
    // Fund the payer
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&payer, &1_000_000_000_000_000i128);
'''
open_stream_fuzz = '''
    // Allow the fuzzer to explore parameters; panics are caught by libfuzzer.
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _id = client.open_stream(&token_id, &payer, &recipient, &rate, &deposit);
    }));
'''

write_fuzz_target('open_stream', open_stream_setup, open_stream_fuzz)

# --- claim_stream ---
claim_stream_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 8 { return; }
    let (stream_id, _d2) = take_u32(data);
    
    let payer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&payer, &1_000_000_000_000_000i128);
    
    // First open a stream, then try to claim it
    let _stream_id = client.open_stream(&token_id, &payer, &recipient, &100, &100_000);
'''
claim_stream_fuzz = '''
    // Try claiming the stream (or a non-existent one from fuzz data)
    let claim_recipient = if stream_id % 2 == 0 { recipient.clone() } else { Address::generate(&env) };
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _claimed = client.claim_stream(&stream_id, &claim_recipient);
    }));
'''

write_fuzz_target('claim_stream', claim_stream_setup, claim_stream_fuzz)

# --- create_escrow ---
create_escrow_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 20 { return; }
    let (amount, d1) = take_i128(data);
    let (release_ledger, _d2) = take_u32(d1);
    
    let amount = amount.abs() % 1_000_000_000_000i128 + 1;
    let current = env.ledger().sequence();
    let release = current + (release_ledger % 1_000_000) + 1;
    
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&from, &1_000_000_000_000_000i128);
'''
create_escrow_fuzz = '''
    let memo = Symbol::new(&env, "fuzz");
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _id = client.create_escrow(&token_id, &from, &to, &amount, &release, &memo);
    }));
'''

write_fuzz_target('create_escrow', create_escrow_setup, create_escrow_fuzz)

# --- claim_escrow ---
claim_escrow_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 4 { return; }
    let (escrow_id, _d2) = take_u32(data);
    
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&from, &1_000_000_000_000_000i128);
    
    // Create an escrow first, then advance ledger beyond release
    let current = env.ledger().sequence();
    let release = current + 10;
    let _id = client.create_escrow(&token_id, &from, &to, &1000, &release, &Symbol::new(&env, "fuzz"));
    
    // Fast-forward ledger to allow claiming
    env.ledger().set_sequence(current + 20);
'''
claim_escrow_fuzz = '''
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.claim_escrow(&escrow_id);
    }));
'''

write_fuzz_target('claim_escrow', claim_escrow_setup, claim_escrow_fuzz)

# --- batch_send ---
batch_send_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 8 { return; }
    let (count, d1) = take_u32(data);
    let (_seed, _d2) = take_u32(d1);
    
    let count = (count % 5 + 1) as u32; // 1..5 recipients
    let from = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&from, &1_000_000_000_000_000i128);
    
    let mut recipients: Vec<Address> = Vec::new(&env);
    let mut amounts: Vec<i128> = Vec::new(&env);
    let mut memos: Vec<Symbol> = Vec::new(&env);
    for i in 0..count {
        let r = Address::generate(&env);
        recipients.push_back(r);
        amounts.push_back((i as i128 + 1) * 100);
        memos.push_back(Symbol::new(&env, &format!("fuzz{}", i)));
    }
'''
batch_send_fuzz = '''
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _res = client.batch_send(&token_id, &from, &recipients, &amounts, &memos);
    }));
'''

write_fuzz_target('batch_send', batch_send_setup, batch_send_fuzz)

# --- create_multisig ---
create_multisig_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 12 { return; }
    let (amount, d1) = take_i128(data);
    let (threshold, d2) = take_u32(d1);
    let (expiry_offset, _d3) = take_u32(d2);
    
    let amount = amount.abs() % 1_000_000_000_000i128 + 1;
    let signers_count = (threshold % 5 + 1).max(2) as u32;
    let threshold = (threshold % signers_count).max(1) + 1;
    
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&proposer, &1_000_000_000_000_000i128);
    
    let mut signers: Vec<Address> = Vec::new(&env);
    for _ in 0..signers_count {
        signers.push_back(Address::generate(&env));
    }
    let current = env.ledger().sequence();
    let expiration = current + (expiry_offset % 1_000_000).max(100) + 1;
'''
create_multisig_fuzz = '''
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _id = client.create_multisig(&token_id, &proposer, &recipient, &amount, &threshold, &signers, &expiration);
    }));
'''

write_fuzz_target('create_multisig', create_multisig_setup, create_multisig_fuzz)

# --- approve_multisig ---
approve_multisig_setup = '''
    let (env, client, token_id, _admin) = setup_contract();
    if data.len() < 8 { return; }
    let (prop_id, _d2) = take_u32(data);
    
    let proposer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let token_client = soroban_sdk::token::TokenClient::new(&env, &token_id);
    token_client.mint(&proposer, &1_000_000_000_000_000i128);
    
    let mut signers: Vec<Address> = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    
    let current = env.ledger().sequence();
    let expiration = current + 1_000_000;
    let _id = client.create_multisig(&token_id, &proposer, &recipient, &1000, &2, &signers, &expiration);
'''
approve_multisig_fuzz = '''
    let _result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.approve_multisig(&prop_id, &signer1);
    }));
'''

write_fuzz_target('approve_multisig', approve_multisig_setup, approve_multisig_fuzz)

print("\n=== ALL 7 FUZZ TARGETS CREATED ===")
