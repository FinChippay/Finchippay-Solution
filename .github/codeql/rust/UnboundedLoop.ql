/**
 * @name Unbounded loop in smart contract
 * @description A `loop` or `while true` construct without an obvious
 *              iteration count derived from a bounded collection may
 *              consume an unbounded amount of CPU (and therefore gas /
 *              ledger resources) in a Soroban smart contract.  Soroban
 *              enforces per-instruction budget limits; an unbounded loop
 *              that processes attacker-controlled data could cause the
 *              transaction to exceed its budget and abort — effectively
 *              a denial-of-service against the contract's availability.
 *
 *              Legitimate loops in the contract (e.g. iterating over
 *              `Vec<Address>` of signers or recipients) are bounded by
 *              the runtime length of the collection.  This query flags
 *              `loop { ... }` and `while true { ... }` blocks that do
 *              not contain a break statement, to catch accidentally
 *              infinite loops introduced during development.
 *
 *              False-positive notes:
 *              - Server-side background loops (retry workers, SSE
 *                monitors) are expected in off-chain code and are not
 *                relevant in the Soroban contract context.  Restrict
 *                this query to files inside `contracts/` to reduce
 *                noise in the report.
 * @kind problem
 * @problem.severity warning
 * @security-severity 6.5
 * @precision medium
 * @id finchippay/unbounded-loop
 * @tags security
 *       availability
 *       denial-of-service
 *       soroban
 *       stellar
 */

import rust

/**
 * A `loop { ... }` expression.
 */
class LoopExpr extends Expr {
  LoopExpr() {
    this instanceof Loop
  }
}

/**
 * A `while` expression whose condition is the literal `true`.
 */
class WhileTrueExpr extends WhileExpr {
  WhileTrueExpr() {
    this.getCondition().(LiteralExpr).getValue() = "true"
  }
}

/**
 * Holds if the loop body contains a `break` expression, which bounds
 * the loop's execution when the break condition is met.
 */
predicate hasBreakStatement(Expr loopExpr) {
  exists(BreakExpr breakExpr |
    breakExpr.getEnclosingFunction() = loopExpr.getEnclosingFunction() and
    breakExpr.getParent+() = loopExpr
  )
}

/**
 * Holds if the loop body contains a `return` expression, which also
 * terminates the loop.
 */
predicate hasReturnStatement(Expr loopExpr) {
  exists(ReturnExpr retExpr |
    retExpr.getEnclosingFunction() = loopExpr.getEnclosingFunction() and
    retExpr.getParent+() = loopExpr
  )
}

/**
 * Holds if the file path suggests this is inside the smart contract
 * source tree (contracts/).
 */
predicate isContractFile(Locatable l) {
  l.getFile().getAbsolutePath().matches("%contracts%")
}

from Expr loop
where
  (loop instanceof LoopExpr or loop instanceof WhileTrueExpr) and
  not hasBreakStatement(loop) and
  not hasReturnStatement(loop) and
  isContractFile(loop)
select loop,
  "Potentially unbounded loop in smart contract code. " +
  "Soroban enforces per-transaction CPU budget limits; an infinite loop will " +
  "exhaust the budget and abort the transaction. " +
  "Ensure the loop terminates by bounding iteration over a collection, " +
  "adding a `break` condition, or refactoring to a bounded iterator."
