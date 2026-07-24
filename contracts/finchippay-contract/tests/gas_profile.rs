#![cfg(test)]

use finchippay_contract::{FinchippayContract, FinchippayContractClient};
use soroban_sdk::{
    testutils::Address as _,
    token, Address, Env, Symbol, Vec,
};
use std::fs::File;
use std::io::Write;

fn deploy(env: &Env) -> (Address, FinchippayContractClient<'_>) {
    let id = env.register(FinchippayContract, ());
    let client = FinchippayContractClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (id, client)
}

fn create_token(env: &Env, admin: &Address, to: &Address, amount: i128) -> Address {
    let sac_contract = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac_contract.address();
    let sac = token::StellarAssetClient::new(env, &token_id);
    sac.mint(to, &amount);
    token_id
}

struct GasReportEntry {
    function: String,
    scenario: String,
    cpu_instructions: u64,
    memory_allocation: u64,
}

#[test]
#[allow(deprecated)]
fn generate_gas_report() {
    let mut entries = std::vec::Vec::new();

    // 1. Profile batch_send with min (1), typical (5), and max (10) recipients
    for size in &[1, 5, 10] {
        let env = Env::default();
        let (_, client) = deploy(&env);
        let admin = client.get_admin();
        let from = Address::generate(&env);
        env.mock_all_auths();

        let total_mint = 1000 * (*size as i128);
        let token_id = create_token(&env, &admin, &from, total_mint);

        let mut recipients = Vec::new(&env);
        let mut amounts = Vec::new(&env);
        let mut memos = Vec::new(&env);
        for _ in 0..*size {
            recipients.push_back(Address::generate(&env));
            amounts.push_back(1000);
            memos.push_back(Symbol::new(&env, "tip"));
        }

        env.budget().reset_unlimited();
        let cpu_before = env.budget().cpu_instruction_cost();
        let mem_before = env.budget().memory_bytes_cost();

        let _ = client.batch_send(&token_id, &from, &recipients, &amounts, &memos);

        let cpu_after = env.budget().cpu_instruction_cost();
        let mem_after = env.budget().memory_bytes_cost();

        entries.push(GasReportEntry {
            function: "batch_send".to_string(),
            scenario: format!("{} recipients", size),
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_allocation: mem_after.saturating_sub(mem_before),
        });
    }

    // 2. Profile create_escrow
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
        let mem_before = env.budget().memory_bytes_cost();

        let _ = client.create_escrow(
            &token_id,
            &from,
            &to,
            &2000,
            &release,
            &Symbol::new(&env, "escrow"),
        );

        let cpu_after = env.budget().cpu_instruction_cost();
        let mem_after = env.budget().memory_bytes_cost();

        entries.push(GasReportEntry {
            function: "create_escrow".to_string(),
            scenario: "typical".to_string(),
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_allocation: mem_after.saturating_sub(mem_before),
        });
    }

    // 3. Profile open_stream
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
        let mem_before = env.budget().memory_bytes_cost();

        let _ = client.open_stream(&token_id, &payer, &recipient, &10, &1000);

        let cpu_after = env.budget().cpu_instruction_cost();
        let mem_after = env.budget().memory_bytes_cost();

        entries.push(GasReportEntry {
            function: "open_stream".to_string(),
            scenario: "typical".to_string(),
            cpu_instructions: cpu_after.saturating_sub(cpu_before),
            memory_allocation: mem_after.saturating_sub(mem_before),
        });
    }

    // Format output as manual JSON
    let mut json_data = String::from("[\n");
    for (i, entry) in entries.iter().enumerate() {
        json_data.push_str("  {\n");
        json_data.push_str(&format!("    \"function\": \"{}\",\n", entry.function));
        json_data.push_str(&format!("    \"scenario\": \"{}\",\n", entry.scenario));
        json_data.push_str(&format!("    \"cpu_instructions\": {},\n", entry.cpu_instructions));
        json_data.push_str(&format!("    \"memory_allocation\": {}\n", entry.memory_allocation));
        if i == entries.len() - 1 {
            json_data.push_str("  }\n");
        } else {
            json_data.push_str("  },\n");
        }
    }
    json_data.push_str("]\n");

    println!("{}", json_data);

    let mut file = File::create("../../gas-report.json").unwrap();
    file.write_all(json_data.as_bytes()).unwrap();
}
