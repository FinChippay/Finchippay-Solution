#![cfg(test)]

use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use soroban_sdk::{testutils::Address as _, token, Address, Env, Symbol, Vec};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&Vec::from_array(env, [admin.clone()]), &1);
    (id, client)
}

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac_contract.address();
    let sac = token::StellarAssetClient::new(env, &token_id);
    sac.mint(to, &amount);
    token_id
}

#[test]
#[allow(deprecated)]
fn run_gas_benchmarks() {
    let mut current_measurements = HashMap::new();

    // 1. send_tip
    {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 5000);

        env.budget().reset_unlimited();
        let cpu_before = env.budget().cpu_instruction_cost();
        client.send_tip(&token_id, &from, &to, &1000, &Symbol::new(&env, "tip"));
        let cpu_after = env.budget().cpu_instruction_cost();
        
        current_measurements.insert("send_tip".to_string(), cpu_after.saturating_sub(cpu_before));
    }

    // 2. create_escrow
    {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 5000);
        let release = env.ledger().sequence() + 100;

        env.budget().reset_unlimited();
        let cpu_before = env.budget().cpu_instruction_cost();
        client.create_escrow(
            &token_id,
            &from,
            &to,
            &2000,
            &release,
            &Symbol::new(&env, "escrow"),
        );
        let cpu_after = env.budget().cpu_instruction_cost();
        
        current_measurements.insert("create_escrow".to_string(), cpu_after.saturating_sub(cpu_before));
    }

    // 3. open_stream
    {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let payer = Address::generate(&env);
        let recipient = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &payer, 5000);

        env.budget().reset_unlimited();
        let cpu_before = env.budget().cpu_instruction_cost();
        client.open_stream(&token_id, &payer, &recipient, &10, &1000);
        let cpu_after = env.budget().cpu_instruction_cost();
        
        current_measurements.insert("open_stream".to_string(), cpu_after.saturating_sub(cpu_before));
    }

    // 4. propose_multi_sig
    {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let proposer = Address::generate(&env);
        let to = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &proposer, 5000);
        let mut signers = Vec::new(&env);
        signers.push_back(Address::generate(&env));
        signers.push_back(Address::generate(&env));

        env.budget().reset_unlimited();
        let cpu_before = env.budget().cpu_instruction_cost();
        client.propose_multi_sig(&token_id, &proposer, &to, &1000, &signers, &2);
        let cpu_after = env.budget().cpu_instruction_cost();
        
        current_measurements.insert("propose_multi_sig".to_string(), cpu_after.saturating_sub(cpu_before));
    }

    // 5. batch_send
    {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        env.mock_all_auths();

        let token_id = create_token(&env, &admin, &from, 5000);
        let mut recipients = Vec::new(&env);
        let mut amounts = Vec::new(&env);
        let mut memos = Vec::new(&env);
        for _ in 0..5 {
            recipients.push_back(Address::generate(&env));
            amounts.push_back(100);
            memos.push_back(Symbol::new(&env, "tip"));
        }

        env.budget().reset_unlimited();
        let cpu_before = env.budget().cpu_instruction_cost();
        client.batch_send(&token_id, &from, &recipients, &amounts, &memos);
        let cpu_after = env.budget().cpu_instruction_cost();
        
        current_measurements.insert("batch_send".to_string(), cpu_after.saturating_sub(cpu_before));
    }

    let baseline_path = Path::new("benches/gas_baseline.json");
    let is_update = std::env::var("UPDATE_BASELINE").unwrap_or_else(|_| "0".to_string()) == "1";

    if is_update || !baseline_path.exists() {
        std::fs::create_dir_all("benches").unwrap();
        let mut file = File::create(baseline_path).unwrap();
        let json_data = format!(
            "{{\n{}\n}}",
            current_measurements
                .iter()
                .map(|(k, v)| format!("  \"{}\": {}", k, v))
                .collect::<std::vec::Vec<_>>()
                .join(",\n")
        );
        file.write_all(json_data.as_bytes()).unwrap();
        println!("Baseline updated.");
        return;
    }

    let mut file = File::open(baseline_path).unwrap();
    let mut contents = String::new();
    file.read_to_string(&mut contents).unwrap();

    // Very naive JSON parsing for this simple map format
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('"') {
            let parts: std::vec::Vec<&str> = line.split(':').collect();
            let key = parts[0].trim().trim_matches('"');
            let val_str = parts[1].trim().trim_matches(',').trim();
            if let Ok(baseline_val) = val_str.parse::<u64>() {
                if let Some(&current_val) = current_measurements.get(key) {
                    let threshold = (baseline_val as f64 * 1.10) as u64;
                    assert!(
                        current_val <= threshold,
                        "Gas regression detected in {}: baseline = {}, current = {} (exceeds 10% threshold)",
                        key, baseline_val, current_val
                    );
                    println!("{}: {} (baseline: {}) - OK", key, current_val, baseline_val);
                }
            }
        }
    }
}
