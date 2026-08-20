#![cfg(test)]

use finchippay_contract::{ContractError, FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Events as _},
    token, vec, Address, Env, IntoVal, Map, Symbol, Val, Vec,
};

#[contracttype]
enum FOTKey {
    Balances,
    FeeBps,
}

#[contract]
pub struct FeeOnTransferToken;

#[contractimpl]
impl FeeOnTransferToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&FOTKey::Balances)
            .unwrap_or(Map::new(&env));
        let bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(to, bal + amount);
        env.storage().instance().set(&FOTKey::Balances, &balances);
    }

    pub fn set_fee_bps(env: Env, fee_bps: u32) {
        env.storage().instance().set(&FOTKey::FeeBps, &fee_bps);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        let balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&FOTKey::Balances)
            .unwrap_or(Map::new(&env));
        balances.get(id).unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let fee_bps: u32 = env.storage().instance().get(&FOTKey::FeeBps).unwrap_or(0);
        let burned = amount * fee_bps as i128 / 10_000;
        let received = amount - burned;
        let mut balances: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&FOTKey::Balances)
            .unwrap_or(Map::new(&env));
        let from_bal = balances.get(from.clone()).unwrap_or(0);
        let to_bal = balances.get(to.clone()).unwrap_or(0);
        balances.set(from, from_bal - amount);
        balances.set(to, to_bal + received);
        env.storage().instance().set(&FOTKey::Balances, &balances);
    }
}

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    let signers = Vec::from_array(env, [admin.clone()]);
    client.initialize(&signers, &1);
    (id, client)
}

fn create_sac(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    let sac_client = token::StellarAssetClient::new(env, &token_id);
    sac_client.mint(to, &amount);
    token_id
}

fn create_fee_token<'a>(
    env: &'a Env,
    holder: &Address,
    amount: i128,
    fee_bps: u32,
) -> (Address, FeeOnTransferTokenClient<'a>) {
    let token_id = env.register(FeeOnTransferToken, ());
    let client = FeeOnTransferTokenClient::new(env, &token_id);
    client.set_fee_bps(&fee_bps);
    client.mint(holder, &amount);
    (token_id, client)
}

fn direct_path(env: &Env, token_in: &Address, token_out: &Address) -> Vec<Address> {
    Vec::from_array(env, [token_in.clone(), token_out.clone()])
}

fn three_hop_path(
    env: &Env,
    token_in: &Address,
    hop: &Address,
    token_out: &Address,
) -> Vec<Address> {
    Vec::from_array(env, [token_in.clone(), hop.clone(), token_out.clone()])
}

#[test]
fn rejects_path_with_less_than_two_tokens() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 1_000);
    let path = Vec::from_array(&env, [token_in.clone()]);

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &100, &0, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidPath);
}

#[test]
fn rejects_path_with_wrong_endpoints() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 1_000);
    let wrong = create_sac(&env, &admin, &contract_id, 1_000);
    let path = direct_path(&env, &wrong, &token_out);

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &100, &0, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::InvalidPath);
}

#[test]
fn rejects_stale_path_that_repeats_a_token() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 1_000);
    let path = Vec::from_array(
        &env,
        [
            token_in.clone(),
            token_out.clone(),
            token_in.clone(),
            token_out.clone(),
        ],
    );

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &100, &0, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::StalePath);
}

#[test]
fn rejects_multi_hop_path_with_zero_liquidity_hop() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let hop = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 1_000);
    let path = three_hop_path(&env, &token_in, &hop, &token_out);

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &100, &0, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::StalePath);
}

#[test]
fn rejects_path_when_output_reserve_is_empty() {
    let env = Env::default();
    let (_contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &caller, 1_000);
    let path = direct_path(&env, &token_in, &token_out);

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &100, &0, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::StalePath);
}

#[test]
fn exact_input_swap_uses_actual_received_for_fee_on_transfer_token() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let (token_in, token_in_client) = create_fee_token(&env, &caller, 2_000, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 10_000);
    let token_out_client = token::Client::new(&env, &token_out);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &898, &path);

    assert_eq!(amount_out, 898);
    assert_eq!(token_in_client.balance(&contract_id), 898);
    assert_eq!(token_out_client.balance(&caller), 898);
}

#[test]
fn exact_input_respects_min_amount_out_at_rounding_boundary() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &997, &path);

    assert_eq!(amount_out, 997);
}

#[test]
fn exact_input_rejects_min_amount_out_above_rounded_output() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let path = direct_path(&env, &token_in, &token_out);

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &998, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::SlippageExceeded);
}

#[test]
fn exact_output_uses_ceiling_rounding_for_required_input() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 2_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_in =
        client.swap_tokens_for_exact_tokens(&caller, &token_in, &token_out, &998, &1_002, &path);

    assert_eq!(amount_in, 1_002);
}

#[test]
fn exact_output_rejects_max_amount_in_below_ceiling_requirement() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 2_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let path = direct_path(&env, &token_in, &token_out);

    let err = client
        .try_swap_tokens_for_exact_tokens(&caller, &token_in, &token_out, &998, &1_001, &path)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, ContractError::ExcessiveAmountIn);
}

#[test]
fn exact_output_uses_max_slippage_buffer_for_fee_on_transfer_input() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let (token_in, token_in_client) = create_fee_token(&env, &caller, 2_000, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let token_out_client = token::Client::new(&env, &token_out);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_in =
        client.swap_tokens_for_exact_tokens(&caller, &token_in, &token_out, &998, &1_120, &path);

    assert_eq!(amount_in, 1_114);
    assert_eq!(token_in_client.balance(&contract_id), 1_000);
    assert_eq!(token_out_client.balance(&caller), 998);
}

#[test]
fn exact_input_slippage_failure_rolls_back_measured_transfer() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let (token_in, token_in_client) = create_fee_token(&env, &caller, 2_000, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 10_000);
    let token_out_client = token::Client::new(&env, &token_out);
    let path = direct_path(&env, &token_in, &token_out);

    let err = client
        .try_swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &899, &path)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, ContractError::SlippageExceeded);
    assert_eq!(token_in_client.balance(&caller), 2_000);
    assert_eq!(token_in_client.balance(&contract_id), 0);
    assert_eq!(token_out_client.balance(&caller), 0);
}

#[test]
fn exact_output_fee_on_transfer_shortfall_rolls_back_top_up() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let (token_in, token_in_client) = create_fee_token(&env, &caller, 2_000, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let token_out_client = token::Client::new(&env, &token_out);
    let path = direct_path(&env, &token_in, &token_out);

    let err = client
        .try_swap_tokens_for_exact_tokens(&caller, &token_in, &token_out, &998, &1_050, &path)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, ContractError::ExcessiveAmountIn);
    assert_eq!(token_in_client.balance(&caller), 2_000);
    assert_eq!(token_in_client.balance(&contract_id), 0);
    assert_eq!(token_out_client.balance(&caller), 0);
}

#[test]
fn dust_swap_accrues_zero_protocol_fee_without_shorting_output() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1);
    let token_out = create_sac(&env, &admin, &contract_id, 10);
    let token_in_client = token::Client::new(&env, &token_in);
    let token_out_client = token::Client::new(&env, &token_out);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1, &1, &path);

    assert_eq!(amount_out, 1);
    assert_eq!(token_in_client.balance(&admin), 0);
    assert_eq!(token_in_client.balance(&contract_id), 1);
    assert_eq!(token_out_client.balance(&caller), 1);
}

#[test]
fn large_swap_accrues_protocol_fee_to_default_collector() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let amount = 1_000_000_000_000i128;
    let expected_fee = 3_000_000_000i128;
    let expected_out = 997_000_000_000i128;
    let token_in = create_sac(&env, &admin, &caller, amount);
    let token_out = create_sac(&env, &admin, &contract_id, amount);
    let token_in_client = token::Client::new(&env, &token_in);
    let token_out_client = token::Client::new(&env, &token_out);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out = client.swap_exact_tokens_for_tokens(
        &caller,
        &token_in,
        &token_out,
        &amount,
        &expected_out,
        &path,
    );

    assert_eq!(amount_out, expected_out);
    assert_eq!(token_in_client.balance(&admin), expected_fee);
    assert_eq!(token_in_client.balance(&contract_id), expected_out);
    assert_eq!(token_out_client.balance(&caller), expected_out);
}

#[test]
fn custom_fee_collector_receives_protocol_fee() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    let collector = Address::generate(&env);
    env.mock_all_auths();

    client.set_fee_collector(&admin, &collector);

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let token_in_client = token::Client::new(&env, &token_in);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &997, &path);

    assert_eq!(amount_out, 997);
    assert_eq!(token_in_client.balance(&collector), 3);
    assert_eq!(token_in_client.balance(&admin), 0);
}

#[test]
fn zero_bps_fee_sends_full_received_amount_to_output() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    let collector = Address::generate(&env);
    env.mock_all_auths();

    client.set_fee_collector(&admin, &collector);
    client.set_swap_fee(&admin, &0);

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let token_in_client = token::Client::new(&env, &token_in);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &1_000, &path);

    assert_eq!(amount_out, 1_000);
    assert_eq!(token_in_client.balance(&collector), 0);
    assert_eq!(token_in_client.balance(&contract_id), 1_000);
}

#[test]
fn max_bps_fee_accrues_ten_percent_to_collector() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    let collector = Address::generate(&env);
    env.mock_all_auths();

    client.set_fee_collector(&admin, &collector);
    client.set_swap_fee(&admin, &1_000);

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let token_in_client = token::Client::new(&env, &token_in);
    let path = direct_path(&env, &token_in, &token_out);

    let amount_out =
        client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &900, &path);

    assert_eq!(amount_out, 900);
    assert_eq!(token_in_client.balance(&collector), 100);
    assert_eq!(token_in_client.balance(&contract_id), 900);
}

#[test]
fn swap_event_records_requested_actual_fee_output_and_path_length() {
    let env = Env::default();
    let (contract_id, client) = deploy(&env);
    let admin = client.get_admin();
    let caller = Address::generate(&env);
    env.mock_all_auths();

    let token_in = create_sac(&env, &admin, &caller, 1_000);
    let token_out = create_sac(&env, &admin, &contract_id, 2_000);
    let path = direct_path(&env, &token_in, &token_out);

    client.swap_exact_tokens_for_tokens(&caller, &token_in, &token_out, &1_000, &997, &path);

    let events = env.events().all().filter_by_contract(&contract_id);
    let expected: Vec<(Address, Vec<Val>, Val)> = vec![
        &env,
        (
            contract_id.clone(),
            (
                Symbol::new(&env, "swap"),
                caller.clone(),
                token_in.clone(),
                token_out.clone(),
            )
                .into_val(&env),
            (1_000i128, 1_000i128, 997i128, 3i128, 2u32).into_val(&env),
        ),
    ];
    assert_eq!(events, expected);
}
