#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{Address, Env};

    #[test]
    fn test_estimate_send_tip() {
        let env = Env::default();
        let client = FinchippayContractClient::new(&env, &env.register_contract(None, FinchippayContract));

        let token = Address::generate(&env);
        let from = Address::generate(&env);
        let to = Address::generate(&env);

        let estimate = client.estimate_send_tip(&token, &from, &to, &100_0000000);

        assert_eq!(estimate.cpu_instructions, 500_000);
        assert_eq!(estimate.ledger_read_bytes, 1_500);
        assert_eq!(estimate.ledger_write_bytes, 500);
        assert!(estimate.estimated_stroops > 0);
    }

    #[test]
    fn test_estimate_create_escrow_and_stream() {
        let env = Env::default();
        let client = FinchippayContractClient::new(&env, &env.register_contract(None, FinchippayContract));

        let token = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let escrow_est = client.estimate_create_escrow(&token, &user1, &user2, &1000, &100);
        let stream_est = client.estimate_open_stream(&token, &user1, &user2, &10, &1000);

        assert!(escrow_est.cpu_instructions >= 750_000);
        assert!(stream_est.cpu_instructions >= 750_000);
    }

    #[test]
    fn test_estimate_batch_send_linear_scaling() {
        let env = Env::default();
        let client = FinchippayContractClient::new(&env, &env.register_contract(None, FinchippayContract));

        let token = Address::generate(&env);
        let from = Address::generate(&env);

        let est_single = client.estimate_batch_send(&token, &from, &1);
        let est_five = client.estimate_batch_send(&token, &from, &5);

        // Verify batch send scales linearly with recipient count
        assert!(est_five.cpu_instructions > est_single.cpu_instructions);
        assert_eq!(
            est_five.cpu_instructions - est_single.cpu_instructions,
            4 * 250_000
        );
        assert_eq!(
            est_five.estimated_stroops - est_single.estimated_stroops,
            4 * 5_000
        );
    }

    #[test]
    fn test_estimate_create_multisig() {
        let env = Env::default();
        let client = FinchippayContractClient::new(&env, &env.register_contract(None, FinchippayContract));

        let est_3_signers = client.estimate_create_multisig(&3, &2);
        let est_5_signers = client.estimate_create_multisig(&5, &3);

        assert!(est_5_signers.cpu_instructions > est_3_signers.cpu_instructions);
        assert!(est_5_signers.estimated_stroops > est_3_signers.estimated_stroops);
    }
}
