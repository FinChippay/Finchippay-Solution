import "@testing-library/jest-dom";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});

// jsdom does not implement SubtleCrypto, so back the global `crypto` with Node's
// Web Crypto implementation for encryption tests.
const globalCrypto = (global as { crypto?: Crypto }).crypto;
if (!globalCrypto || !globalCrypto.subtle) {
  try {
    Object.defineProperty(global, "crypto", {
      value: webcrypto as unknown as Crypto,
      configurable: true,
      writable: true,
    });
  } catch {
    // Fall back to patching just the subtle/getRandomValues surface.
    Object.assign(global, { crypto: webcrypto });
  }
}
