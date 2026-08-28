use soroban_sdk::{contracttype, xdr::ToXdr, Address, Bytes, BytesN, Env, Symbol, Vec};

use crate::{require_not_paused, DataKey};

#[contracttype]
#[derive(Clone)]
pub struct MerkleAirdrop {
    pub id: u32,
    pub funder: Address,
    pub token: Address,
    pub merkle_root: BytesN<32>,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub expiration_ledger: u32,
    pub cancelled: bool,
}

fn hash_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let mut combined = Bytes::new(env);
    combined.append(&left.clone().to_xdr(env));
    combined.append(&right.clone().to_xdr(env));
    env.crypto().sha256(&combined).into()
}

fn hash_leaf(env: &Env, recipient: &Address, amount: i128) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&recipient.clone().to_xdr(env));
    data.append(&Bytes::from_slice(env, &amount.to_be_bytes()));
    env.crypto().sha256(&data).into()
}

pub fn verify_merkle_proof(
    env: &Env,
    leaf: BytesN<32>,
    proof: Vec<BytesN<32>>,
    root: BytesN<32>,
    index: u32,
) -> bool {
    let mut current = leaf;
    let mut idx = index;

    for sibling in proof.iter() {
        let (left, right) = if idx % 2 == 0 {
            (current.clone(), sibling.clone())
        } else {
            (sibling.clone(), current.clone())
        };
        current = hash_pair(env, &left, &right);
        idx /= 2;
    }

    current == root
}

pub fn create_airdrop(
    env: &Env,
    token: Address,
    funder: Address,
    merkle_root: BytesN<32>,
    total_amount: i128,
    expiration_ledger: u32,
) -> u32 {
    require_not_paused(env);
    funder.require_auth();

    if total_amount <= 0 {
        panic!("Amount must be positive");
    }

    if expiration_ledger <= env.ledger().sequence() {
        panic!("Expiration must be in the future");
    }

    let token_client = soroban_sdk::token::Client::new(env, &token);
    token_client.transfer(&funder, &env.current_contract_address(), &total_amount);

    let count: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::AirdropCount)
        .unwrap_or(0);

    let id = count;
    let airdrop = MerkleAirdrop {
        id,
        funder: funder.clone(),
        token: token.clone(),
        merkle_root: merkle_root.clone(),
        total_amount,
        claimed_amount: 0,
        expiration_ledger,
        cancelled: false,
    };

    env.storage()
        .persistent()
        .set(&DataKey::Airdrop(id), &airdrop);
    env.storage()
        .persistent()
        .set(&DataKey::AirdropCount, &(count + 1));

    env.events().publish(
        (Symbol::new(env, "airdrop_created"), id),
        (funder, token, total_amount),
    );

    id
}

pub fn claim_airdrop(
    env: &Env,
    airdrop_id: u32,
    recipient: Address,
    amount: i128,
    proof: Vec<BytesN<32>>,
    index: u32,
) {
    require_not_paused(env);
    recipient.require_auth();

    let mut airdrop: MerkleAirdrop = env
        .storage()
        .persistent()
        .get(&DataKey::Airdrop(airdrop_id))
        .unwrap_or_else(|| panic!("Airdrop not found"));

    if airdrop.cancelled {
        panic!("Airdrop has been cancelled");
    }

    if env.ledger().sequence() > airdrop.expiration_ledger {
        panic!("Airdrop has expired");
    }

    if env
        .storage()
        .persistent()
        .get::<_, bool>(&DataKey::AirdropClaimed(airdrop_id, recipient.clone()))
        .is_some()
    {
        panic!("Already claimed");
    }

    let leaf = hash_leaf(env, &recipient, amount);
    if !verify_merkle_proof(env, leaf, proof, airdrop.merkle_root.clone(), index) {
        panic!("Invalid Merkle proof");
    }

    if airdrop.claimed_amount + amount > airdrop.total_amount {
        panic!("Claim exceeds remaining airdrop amount");
    }

    let token_client = soroban_sdk::token::Client::new(env, &airdrop.token);
    token_client.transfer(&env.current_contract_address(), &recipient, &amount);

    airdrop.claimed_amount += amount;
    env.storage()
        .persistent()
        .set(&DataKey::Airdrop(airdrop_id), &airdrop);
    env.storage().persistent().set(
        &DataKey::AirdropClaimed(airdrop_id, recipient.clone()),
        &true,
    );

    env.events().publish(
        (Symbol::new(env, "airdrop_claimed"), airdrop_id),
        (recipient, amount),
    );
}

pub fn cancel_airdrop(env: &Env, airdrop_id: u32, funder: Address) {
    require_not_paused(env);
    funder.require_auth();

    let mut airdrop: MerkleAirdrop = env
        .storage()
        .persistent()
        .get(&DataKey::Airdrop(airdrop_id))
        .unwrap_or_else(|| panic!("Airdrop not found"));

    if airdrop.funder != funder {
        panic!("Only the funder can cancel");
    }

    if airdrop.cancelled {
        panic!("Already cancelled");
    }

    if env.ledger().sequence() <= airdrop.expiration_ledger {
        panic!("Cannot cancel before expiration");
    }

    let unclaimed = airdrop.total_amount - airdrop.claimed_amount;
    if unclaimed > 0 {
        let token_client = soroban_sdk::token::Client::new(env, &airdrop.token);
        token_client.transfer(&env.current_contract_address(), &funder, &unclaimed);
    }

    airdrop.cancelled = true;
    env.storage()
        .persistent()
        .set(&DataKey::Airdrop(airdrop_id), &airdrop);

    env.events().publish(
        (Symbol::new(env, "airdrop_cancelled"), airdrop_id),
        (funder, unclaimed),
    );
}
