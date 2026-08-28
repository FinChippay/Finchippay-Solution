/**
 * @name Raw panic! without structured error type
 * @description Calling `panic!()` or `unwrap()` / `expect()` with an
 *              unstructured string message in a Soroban smart contract
 *              aborts the transaction with an opaque error.  This makes
 *              it impossible for callers, indexers, and front-ends to
 *              distinguish between different failure modes (e.g. "amount
 *              overflow" vs. "contract paused" vs. "caller not authorized").
 *
 *              The FinchippayContract defines a `ContractError` enum with
 *              numbered variants and uses `Err(ContractError::Variant)` to
 *              propagate them.  Arithmetic guards use
 *              `.expect("overflow")` / `.expect("underflow")` which is
 *              intentional (overflow is always a bug); this query excludes
 *              those specific expect messages.
 *
 *              This query flags:
 *              - `panic!("arbitrary string")` — use `return Err(ContractError::X)`
 *              - `.unwrap()` with no message — use `.expect("context")` or `?`
 *
 *              It excludes:
 *              - `.expect("overflow")` / `.expect("underflow")` —
 *                these are intentional arithmetic guards.
 *              - `.expect("Contract not initialized")` — a legitimate
 *                guard in the `get_admin` helper.
 *              - Test code (`#[test]` / `#[cfg(test)]`).
 * @kind problem
 * @problem.severity warning
 * @security-severity 5.0
 * @precision medium
 * @id finchippay/raw-panic-without-error
 * @tags reliability
 *       maintainability
 *       error-handling
 *       soroban
 *       stellar
 */

import rust

/**
 * A call to the `panic!` macro.
 */
class PanicMacroCall extends MacroCall {
  PanicMacroCall() {
    this.getMacroName() = "panic"
  }
}

/**
 * A method call to `.unwrap()` on any expression.
 */
class UnwrapCall extends MethodCall {
  UnwrapCall() {
    this.getMethodName() = "unwrap"
  }
}

/**
 * A method call to `.expect(msg)` where `msg` is NOT one of the
 * intentional arithmetic / initialization guard messages used throughout
 * the contract.
 */
class UnstructuredExpectCall extends MethodCall {
  UnstructuredExpectCall() {
    this.getMethodName() = "expect" and
    // Exclude known-intentional guard messages
    not this.getArgument(0).(LiteralExpr).getValue().regexpMatch(
      "(?i)(overflow|underflow|contract not initialized|already initialized)"
    )
  }
}

/**
 * Holds if the code location is inside a test function or test module.
 */
predicate isTestCode(Locatable l) {
  exists(Function f |
    l.getEnclosingFunction() = f and
    (
      f.getName().regexpMatch("(?i)test.*") or
      f.hasAttributeWithName("test")
    )
  )
}

/**
 * Holds if the file path suggests this is inside the smart contract
 * source tree.
 */
predicate isContractFile(Locatable l) {
  l.getFile().getAbsolutePath().matches("%contracts%")
}

from Expr rawPanic, string description
where
  isContractFile(rawPanic) and
  not isTestCode(rawPanic) and
  (
    rawPanic instanceof PanicMacroCall and
    description = "panic!() macro invocation"
    or
    rawPanic instanceof UnwrapCall and
    description = ".unwrap() call without error context"
    or
    rawPanic instanceof UnstructuredExpectCall and
    description = ".expect() call with unstructured string message"
  )
select rawPanic,
  "Raw " + description + " found in smart contract code outside of intentional arithmetic guards. " +
  "Soroban contract entry-points should return structured errors via " +
  "`Err(ContractError::VariantName)` so callers can programmatically distinguish " +
  "failure modes. Replace with a structured ContractError variant or, for arithmetic " +
  "overflow guards, use `.expect(\"overflow\")` / `.expect(\"underflow\")`."
