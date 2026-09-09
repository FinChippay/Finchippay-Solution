import "@testing-library/jest-dom";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";
import { toHaveNoViolations } from "jest-axe";

// jsdom does not implement IndexedDB, but several libs/components open a DB
// at runtime (offlineQueue, cacheData, contactsDB, transactionSearchIndex).
// Install fake-indexeddb globally so any suite that touches them behaves like
// a browser instead of crashing the whole run with a ReferenceError.
import "fake-indexeddb/auto";

// jsdom does not implement `fetch`, but several modules construct HTTP clients
// at import time (e.g. @/lib/api's FinchippayClient) that require a global
// fetch to exist. Browsers always have it; provide one here so tests match.
if (typeof globalThis.fetch !== "function") {
  const noopFetch = async (): Promise<Response> => {
    throw new Error(
      "fetch is not available in this test environment. Mock global.fetch before the code under test calls it.",
    );
  };
  globalThis.fetch = noopFetch as typeof fetch;
}

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
