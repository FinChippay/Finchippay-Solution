/**
 * @name Missing checked arithmetic in financial computation
 * @description Arithmetic operations on integer types in financial or
 *              payment-related Rust code without using checked_add,
 *              checked_sub, checked_mul (or saturating_/wrapping_ variants)
 *              can silently overflow in debug builds that have overflow
 *              checks disabled, or in release builds where wrapping
 *              arithmetic is the default.  In the Soroban environment,
 *              token amounts and ledger counters are i128/u32 values;
 *              an undetected overflow could allow an attacker to drain
 *              funds or corrupt streaming-payment accumulators.
 *
 *              The FinchippayContract explicitly uses checked_add /
 *              checked_sub / checked_mul with .expect("overflow") throughout
 *              its financial logic.  This query flags any direct use of the
 *              `+`, `-`, or `*` binary operators on integer-typed expressions
 *              inside functions whose names suggest financial operations
 *              (amount, balance, stream, escrow, tip, batch).
 *
 *              False-positive notes:
 *              - Loop counter increments (i += 1 / i + 1) are common and
 *                benign; this query restricts itself to expressions involving
 *                identifiers that suggest monetary values.
 *              - The contract already uses checked arithmetic everywhere;
 *                this query is designed to catch regressions introduced by
 *                future contributors.
 * @kind problem
 * @problem.severity warning
 * @security-severity 7.5
 * @precision medium
 * @id finchippay/missing-checked-arithmetic
 * @tags security
 *       correctness
 *       overflow
 *       stellar
 *       soroban
 */

import rust

/**
 * A binary expression that uses a potentially-overflowing arithmetic operator.
 */
class ArithmeticExpr extends BinaryExpr {
  ArithmeticExpr() {
    this.getOperator() = "+" or
    this.getOperator() = "-" or
    this.getOperator() = "*"
  }
}

/**
 * Holds if the identifier name suggests it holds a monetary or ledger
 * counter value relevant to financial security.
 */
predicate isFinancialIdentifier(string name) {
  name.regexpMatch("(?i).*(amount|balance|deposit|claimed|streamed|rate|total|fee|tip|escrow|stream|locked|vesting|proposal).*")
}

/**
 * Holds if the expression is an identifier that suggests a financial value.
 */
predicate isFinancialExpr(Expr e) {
  exists(VariableAccess va |
    va = e and
    isFinancialIdentifier(va.getVariable().getName())
  )
}

/**
 * Holds if the function name suggests it performs financial operations.
 */
predicate isFinancialFunction(Function f) {
  f.getName().regexpMatch("(?i).*(send|transfer|pay|escrow|stream|tip|batch|claim|deposit|withdraw|mint|amount|balance|vesting|multisig|multi_sig).*")
}

from ArithmeticExpr expr, Function enclosing
where
  enclosing = expr.getEnclosingFunction() and
  isFinancialFunction(enclosing) and
  (
    isFinancialExpr(expr.getLeftOperand()) or
    isFinancialExpr(expr.getRightOperand())
  ) and
  // Exclude compound assignment to loop counters (i += 1 patterns)
  not (
    expr.getOperator() = "+" and
    expr.getRightOperand().(LiteralExpr).getValue() = "1"
  )
select expr,
  "Direct arithmetic operator '" + expr.getOperator() + "' used in financial function '" +
  enclosing.getName() + "' without checked_add/checked_sub/checked_mul. " +
  "Replace with .checked_" +
  (if expr.getOperator() = "+" then "add" else if expr.getOperator() = "-" then "sub" else "mul") +
  "(...).expect(\"overflow\") to ensure overflows panic rather than wrap silently."
