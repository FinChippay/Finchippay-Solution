# Testing Guide

## Overview

Finchippay Solution uses a multi-layered testing strategy:

| Layer | Tool | Command |
|---|---|---|
| **Rust unit tests** | `cargo test` | `cargo test --workspace` |
| **Rust fuzz tests** | `cargo-fuzz` | `cargo fuzz run <target>` |
| **Backend unit tests** | Jest | `npm run test --prefix backend` |
| **Backend integration** | Jest + Supertest | `npm run test:integration --prefix backend` |
| **Frontend unit tests** | Jest + React Testing Library | `npm test --prefix frontend` |
| **Frontend E2E** | Playwright | `npx playwright test --config frontend/playwright.config.ts` |
| **Accessibility** | axe-core + jest-axe | `npm test --prefix frontend -- a11y` |
| **Performance** | Lighthouse CI | Runs on PR (`.github/workflows/ci.yml`) |
| **Load tests** | k6/Artillery | `node tests/load/run-all.sh` |
| **Contract fuzzing** | `cargo-fuzz` | `./scripts/fuzz-contract.sh` |

## Coverage Targets

| Component | Lines | Branches | Functions |
|---|---|---|---|
| Backend | ≥ 60% | ≥ 50% | ≥ 55% |
| Frontend | ≥ 65% | ≥ 60% | ≥ 60% |

## Running Tests

### All tests
```bash
# Full suite
make test
```

### Backend only
```bash
cd backend
npm test                    # Unit tests
npm run test:integration    # Integration tests
```

### Frontend only
```bash
cd frontend
npm test                    # Unit tests
npx playwright test         # E2E tests
```

### Contract tests
```bash
cd contracts/finchippay-contract
cargo test                  # Unit tests
cargo fuzz run fuzz_target  # Property fuzzing
```

## Writing Tests

### Backend (Jest)
```javascript
const request = require("supertest");
const app = require("../src/server");

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
```

### Frontend (React Testing Library)
```tsx
import { render, screen } from "@testing-library/react";
import SendPaymentForm from "@/components/SendPaymentForm";

test("renders destination input", () => {
  render(<SendPaymentForm publicKey="G..." xlmBalance="100" />);
  expect(screen.getByPlaceholderText("G..., alice*domain.com")).toBeVisible();
});
```

### Contract (Rust)
```rust
#[test]
fn test_create_escrow() {
    let env = Env::default();
    let contract = FinchippayContractClient::new(&env, &contract_id);
    // ... test escrow creation flow
}
```

## Continuous Integration

All tests run on every PR. See `.github/workflows/ci.yml` for the full matrix.
