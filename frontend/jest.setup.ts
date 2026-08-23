import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});

// MatchMedia stub for ThemeProvider tests (Issue #19, #46).
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: jest.fn((query: string) => ({
    get matches() {
      return false;
    },
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(() => true),
  })),
});
