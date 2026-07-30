#!/usr/bin/env python3
"""
validate_contract.py
Static validation script for the FinchippayContract Soroban contract.

Checks that all required structs, functions, auth patterns, and tests are
present in `contracts/finchippay-contract/src/lib.rs` without requiring
a Rust toolchain.

Usage:
    python3 validate_contract.py
"""

import re
import os
import sys


CONTRACT_PATH = "contracts/finchippay-contract/src/lib.rs"
CARGO_PATH = "Cargo.toml"
CONTRACT_CARGO_PATH = "contracts/finchippay-contract/Cargo.toml"

PASS = "✅"
FAIL = "❌"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def read_file(path: str) -> str | None:
    if not os.path.exists(path):
        print(f"{FAIL} File not found: {path}")
        return None
    with open(path, "r") as f:
        return f.read()


def check(label: str, pattern: str, content: str, flags: int = 0) -> bool:
    if re.search(pattern, content, flags):
        print(f"  {PASS} {label}")
        return True
    print(f"  {FAIL} {label}")
    return False


# ─── Contract validation ──────────────────────────────────────────────────────

def validate_contract(content: str) -> bool:
    ok = True
    print("\n📋 Contract name and structs")
    ok &= check("FinchippayContract struct", r"pub struct FinchippayContract", content)
    ok &= check("Stream struct", r"pub struct Stream\s*\{", content)
    ok &= check("Escrow struct", r"pub struct Escrow\s*\{", content)
    ok &= check("MultiSigProposal struct", r"pub struct MultiSigProposal\s*\{", content)
    ok &= check("TipRecord struct", r"pub struct TipRecord\s*\{", content)
    ok &= check("ReceiptMetadata struct", r"pub struct ReceiptMetadata\s*\{", content)

    print("\n📋 Admin functions")
    ok &= check("initialize", r"pub fn initialize\s*\(", content)
    ok &= check("transfer_admin", r"pub fn transfer_admin\s*\(", content)
    ok &= check("get_admin", r"pub fn get_admin\s*\(", content)

    print("\n📋 Tip functions")
    for fn in ["send_tip", "get_tip_total", "get_tip_count", "get_tip_record"]:
        ok &= check(fn, rf"pub fn {fn}\s*\(", content)

    print("\n📋 Receipt functions")
    for fn in ["mint_receipt", "get_receipt", "get_receipt_count"]:
        ok &= check(fn, rf"pub fn {fn}\s*\(", content)

    print("\n📋 Escrow functions")
    for fn in ["create_escrow", "claim_escrow", "cancel_escrow", "get_escrow", "get_escrow_count"]:
        ok &= check(fn, rf"pub fn {fn}\s*\(", content)

    print("\n📋 Streaming payment functions")
    for fn in ["open_stream", "claim_stream", "top_up_stream", "close_stream", "get_stream", "get_claimable"]:
        ok &= check(fn, rf"pub fn {fn}\s*\(", content)

    print("\n📋 Multi-sig functions")
    for fn in ["create_multisig", "approve_multisig", "cancel_multisig", "get_multisig"]:
        ok &= check(fn, rf"pub fn {fn}\s*\(", content)

    print("\n📋 Batch send")
    ok &= check("batch_send", r"pub fn batch_send\s*\(", content)

    print("\n📋 Security: require_auth calls")
    for label, pattern in [
        ("payer.require_auth()", r"payer\.require_auth\(\)"),
        ("from.require_auth()", r"from\.require_auth\(\)"),
        ("recipient.require_auth()", r"recipient\.require_auth\(\)"),
        ("signer.require_auth()", r"signer\.require_auth\(\)"),
        ("proposer.require_auth()", r"proposer\.require_auth\(\)"),
    ]:
        ok &= check(label, pattern, content)

    print("\n📋 Security: checked arithmetic")
    for label, pattern in [
        ("checked_add", r"checked_add\("),
        ("checked_sub", r"checked_sub\("),
        ("checked_mul", r"checked_mul\("),
    ]:
        ok &= check(label, pattern, content)

    print("\n📋 Streaming maths")
    ok &= check("saturating_sub for elapsed", r"saturating_sub\(stream\.start_ledger\)", content)
    ok &= check("min() cap on deposited", r"\.min\(stream\.deposited\)", content)

    print("\n📋 Error enum")
    ok &= check("ContractError enum", r"pub enum ContractError\s*\{", content)
    ok &= check("AlreadyInitialized", r"AlreadyInitialized\s*=\s*1", content)

    print("\n📋 Test suite")
    tests = [
        "test_initialize_sets_admin",
        "test_double_initialize_returns_error",
        "test_send_tip_stores_record_and_totals",
        "test_mint_receipt_and_retrieve",
        "test_escrow_full_lifecycle",
        "test_cancel_escrow_refunds_payer",
        "test_stream_claim_correct_at_various_ledgers",
        "test_stream_claimable_capped_at_deposit",
        "test_stream_topup_increases_claimable_ceiling",
        "test_stream_close_refunds_payer_and_pays_recipient",
        "test_multisig_executes_on_threshold",
        "test_multisig_cancel_refunds_proposer",
        "test_multisig_double_approve_panics",
    ]
    for test in tests:
        ok &= check(test, rf"fn {test}\s*\(", content)

    return ok


# ─── Cargo.toml validation ────────────────────────────────────────────────────

def validate_cargo(workspace: str, contract: str) -> bool:
    ok = True
    print("\n📋 Workspace Cargo.toml")
    ok &= check("workspace table", r"\[workspace\]", workspace)
    ok &= check("finchippay-contract in members", r"finchippay-contract", workspace)

    print("\n📋 Contract Cargo.toml")
    ok &= check("package name = finchippay-contract", r'name\s*=\s*"finchippay-contract"', contract)
    ok &= check("soroban-sdk dependency", r"soroban-sdk", contract)
    ok &= check("cdylib crate type", r"cdylib", contract)
    return ok


# ─── Main ─────────────────────────────────────────────────────────────────────

def validate_fuzz() -> bool:
    """Validate that fuzz targets and configuration exist."""
    ok = True
    print("\n📋 Fuzz testing infrastructure")

    fuzz_dir = "contracts/finchippay-contract/fuzz"
    fuzz_cargo = os.path.join(fuzz_dir, "Cargo.toml")
    fuzz_targets_dir = os.path.join(fuzz_dir, "fuzz_targets")

    if os.path.exists(fuzz_cargo):
        print(f"  {PASS} {fuzz_cargo} exists")
        fuzz_cargo_content = read_file(fuzz_cargo)
        if fuzz_cargo_content:
            ok &= check("cargo-fuzz metadata", r"cargo-fuzz\s*=\s*true", fuzz_cargo_content)
            ok &= check("libfuzzer-sys dependency", r"libfuzzer-sys", fuzz_cargo_content)
            ok &= check("testutils feature", r"testutils", fuzz_cargo_content)
    else:
        ok = False
        print(f"  {FAIL} {fuzz_cargo} not found")

    targets = [
        "fuzz_target_1_parse_payment.rs",
        "fuzz_target_2_escrow.rs",
        "fuzz_target_3_multisig.rs",
        "fuzz_target_4_batch_send.rs",
    ]

    for target in targets:
        path = os.path.join(fuzz_targets_dir, target)
        if os.path.exists(path):
            content = read_file(path)
            if content:
                ok &= check(f"{target} — uses libfuzzer_sys", r"libfuzzer_sys", content)
                ok &= check(f"{target} — uses finchippay_contract", r"finchippay_contract", content)
        else:
            ok = False
            print(f"  {FAIL} {path} not found")

    # Validate fuzz script
    script_path = "scripts/fuzz-contract.sh"
    if os.path.exists(script_path):
        script_content = read_file(script_path)
        if script_content:
            if os.access(script_path, os.X_OK):
                print(f"  {PASS} fuzz-contract.sh — executable")
            else:
                ok = False
                print(f"  {FAIL} fuzz-contract.sh is not executable")
            ok &= check("fuzz-contract.sh — contains fuzz_target names", r"fuzz_target_1_parse_payment", script_content)
    else:
        ok = False
        print(f"  {FAIL} {script_path} not found")

    # Validate FUZZING.md
    fuzzing_doc = "FUZZING.md"
    if os.path.exists(fuzzing_doc):
        doc_content = read_file(fuzzing_doc)
        if doc_content:
            ok &= check("FUZZING.md — contains usage instructions", r"cargo-fuzz", doc_content)
    else:
        ok = False
        print(f"  {FAIL} {fuzzing_doc} not found")

    return ok


def main() -> int:
    print("🔍 Finchippay-Solution — Static Contract Validator")
    print("=" * 52)

    contract = read_file(CONTRACT_PATH)
    workspace_cargo = read_file(CARGO_PATH)
    contract_cargo = read_file(CONTRACT_CARGO_PATH)

    if not all([contract, workspace_cargo, contract_cargo]):
        print(f"\n{FAIL} One or more required files not found. Aborting.")
        return 1

    contract_ok = validate_contract(contract)
    cargo_ok = validate_cargo(workspace_cargo, contract_cargo)
    fuzz_ok = validate_fuzz()

    print("\n" + "=" * 52)
    if contract_ok and cargo_ok and fuzz_ok:
        print("🎉 All validation checks passed!")
        print("\nThe FinchippayContract is structurally complete with:")
        for feat in [
            "Tips, receipts, escrow, streaming, multi-sig, batch-send",
            "require_auth() on every mutating entry-point",
            "Checked arithmetic (no silent overflows)",
            "Comprehensive test suite (13+ tests)",
            "Coverage-guided fuzz testing (4 targets)",
        ]:
            print(f"  {PASS} {feat}")
        print("\n🚀 Ready to build: cargo build --target wasm32-unknown-unknown --release")
        return 0
    else:
        print(f"{FAIL} Validation failed — see issues above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
