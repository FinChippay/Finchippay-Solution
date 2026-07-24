/**
 * @name Hardcoded Stellar secret key
 * @description A Stellar secret key (starting with 'S') is hardcoded in the
 *              source code. Stellar secret keys are 56-character Base32-encoded
 *              strings that begin with 'S'. Committing them exposes the
 *              corresponding Stellar account to theft.
 * @kind problem
 * @problem.severity error
 * @security-severity 9.5
 * @precision high
 * @id finchippay/hardcoded-stellar-secret-key
 * @tags security
 *       cryptography
 *       stellar
 *       credentials
 */

import javascript

/**
 * A string literal whose value matches the Stellar secret-key format:
 *   - Starts with 'S'
 *   - Exactly 56 uppercase Base32 characters (A-Z, 2-7)
 *   - The checksum prefix makes 'S' the natural first character for
 *     a Stellar Ed25519 seed encoded in Stellar's StrKey format.
 */
class StellarSecretKeyLiteral extends StringLiteral {
  StellarSecretKeyLiteral() {
    // Stellar secret keys: S + 55 chars from [A-Z2-7] = 56 chars total
    this.getStringValue().regexpMatch("S[A-Z2-7]{55}")
  }
}

from StellarSecretKeyLiteral secret
select secret,
  "Hardcoded Stellar secret key found. Secret keys must never appear in source code. " +
  "Use environment variables (process.env.STELLAR_SECRET_KEY) or a secrets manager instead."
