import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

Object.assign(global, {
  TextEncoder,
  TextDecoder,
});

// Default API URL for test suites that reference the SDK via sdk-instance.
// Must be set before module load so the SDK instance picks up the right baseUrl.
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
