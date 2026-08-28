/**
 * @name Sensitive private data stored in localStorage
 * @description Storing private keys, seed phrases, mnemonics, or other
 *              cryptographic secrets in localStorage (or sessionStorage)
 *              exposes them to XSS attacks. Any script running on the same
 *              origin can read localStorage, so cryptographic key material
 *              must never reside there. Use in-memory state (React state,
 *              module-level variables) or a hardware wallet / browser
 *              extension instead.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.5
 * @precision medium
 * @id finchippay/local-storage-private-data
 * @tags security
 *       cryptography
 *       stellar
 *       xss
 */

import javascript

/**
 * A storage key string whose name suggests it holds private / secret
 * cryptographic material. The pattern is intentionally broad to catch
 * common naming conventions used across the codebase.
 */
class SensitiveStorageKey extends StringLiteral {
  SensitiveStorageKey() {
    this.getStringValue()
        .regexpMatch("(?i).*(secret|private.?key|seed|mnemonic|privkey|priv_key|stellar.?secret|keypair|sk_).*")
  }
}

/**
 * A call to localStorage.setItem or sessionStorage.setItem where the
 * storage key string suggests the value is private key material.
 */
class SensitiveLocalStorageWrite extends MethodCallExpr {
  string storageObject;

  SensitiveLocalStorageWrite() {
    (
      this.getReceiver().(GlobalVarAccess).getName() = "localStorage" or
      this.getReceiver().(PropAccess).getPropertyName() = "localStorage" or
      this.getReceiver().(GlobalVarAccess).getName() = "sessionStorage" or
      this.getReceiver().(PropAccess).getPropertyName() = "sessionStorage"
    ) and
    this.getMethodName() = "setItem" and
    this.getArgument(0) instanceof SensitiveStorageKey and
    (
      storageObject = "localStorage"
      or
      storageObject = "sessionStorage"
    )
  }

  string getStorageObject() { result = storageObject }
}

/**
 * Also detect window.localStorage.setItem patterns.
 */
class WindowStorageWrite extends MethodCallExpr {
  WindowStorageWrite() {
    exists(PropAccess storageAccess |
      storageAccess = this.getReceiver() and
      (
        storageAccess.getPropertyName() = "localStorage" or
        storageAccess.getPropertyName() = "sessionStorage"
      ) and
      storageAccess.getBase().(GlobalVarAccess).getName() = "window"
    ) and
    this.getMethodName() = "setItem" and
    this.getArgument(0) instanceof SensitiveStorageKey
  }
}

from Expr write, string storageType, string keyName
where
  (
    exists(SensitiveLocalStorageWrite s |
      write = s and
      storageType = s.getStorageObject() and
      keyName = s.getArgument(0).(StringLiteral).getStringValue()
    )
    or
    exists(WindowStorageWrite w |
      write = w and
      storageType = "localStorage/sessionStorage (window.*)" and
      keyName = w.getArgument(0).(StringLiteral).getStringValue()
    )
  )
select write,
  "Possible sensitive private data (" + keyName + ") written to " + storageType + ". " +
  "Cryptographic key material must not be persisted in browser storage — " +
  "it is accessible to any same-origin JavaScript and is vulnerable to XSS. " +
  "Store secrets in memory only (e.g. React state) or use a hardware wallet / extension."
