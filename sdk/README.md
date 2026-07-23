# @finchippay/sdk

> TypeScript client library for the [Finchippay Solution](https://github.com/FinChippay/Finchippay-Solution) API — instant, low-fee payments on the Stellar network.

[![npm version](https://img.shields.io/npm/v/@finchippay/sdk)](https://www.npmjs.com/package/@finchippay/sdk)

## Installation

```bash
npm install @finchippay/sdk
```

## Quick Start

```ts
import { FinchippayClient } from "@finchippay/sdk";

// Initialize the client
const sdk = new FinchippayClient({
  baseUrl: "https://api.stellarfinchippay.io",
});

// 1. Check server health
const health = await sdk.health();
console.log("API status:", health.status);

// 2. Get account balance (no auth required)
const { data } = await sdk.accounts.getBalance("G...PUBLIC_KEY...");
console.log("XLM balance:", data.balance);

// 3. Fetch payment history
const { data: payments } = await sdk.payments.getHistory("G...PUBLIC_KEY...", {
  limit: 20,
});
console.log("Transactions:", payments);
```

## Authentication (SEP-0010)

Some endpoints require a JWT token obtained via SEP-0010 challenge/response:

```ts
// Step 1: Get a challenge transaction from the server
const challenge = await sdk.getChallenge("G...PUBLIC_KEY...");
console.log("Challenge XDR:", challenge.transaction);

// Step 2: Sign the challenge XDR with the user's Stellar keypair
// (using Freighter, @stellar/stellar-sdk, or your wallet)
//
//   const keypair = StellarSdk.Keypair.fromSecret("S...SECRET...");
//   const signed = keypair.sign(challenge.transaction);
//
// (See the SEP-0010 section below for a complete example)

// Step 3: Submit the signed challenge to get a JWT
const { token } = await sdk.verifyChallenge(signedChallengeXDR);
// The token is automatically cached and attached to future requests

// Step 4: Now you can call authenticated endpoints
const deployments = await sdk.turrets.list({ ownerPublicKey: "G..." });
```

### Full SEP-0010 flow with @stellar/stellar-sdk

```ts
import { FinchippayClient } from "@finchippay/sdk";
import { Keypair } from "@stellar/stellar-sdk";
import { signChallenge } from "./helpers"; // see below

const sdk = new FinchippayClient({ baseUrl: "http://localhost:4000" });
const userKeypair = Keypair.fromSecret("S...SECRET...");

// The server sends a ManageData operation that must be signed
const challenge = await sdk.getChallenge(userKeypair.publicKey());

// Sign the transaction XDR
const { signChallengeXDR } = await import("./sep10-helpers"); // or use @stellar/stellar-sdk directly
const signedXDR = await signChallenge(
  challenge.transaction,
  userKeypair
);

// Verify and get JWT
const { token } = await sdk.verifyChallenge(signedXDR);

// Token is now auto-attached — all subsequent requests are authenticated!
console.log("JWT:", token);
```

## API Reference

### Constructor

```ts
const sdk = new FinchippayClient(options?: FinchippayClientOptions);
```

| Option      | Type              | Default                 | Description                                          |
|-------------|-------------------|-------------------------|------------------------------------------------------|
| `baseUrl`   | `string`          | `http://localhost:4000` | Base URL of the Finchippay API server                |
| `authToken` | `string`          | `null`                  | Pre-existing JWT token (optional)                    |
| `fetch`     | `typeof fetch`    | `globalThis.fetch`      | Custom fetch implementation (e.g. for Node.js < 18)  |
| `cacheToken`| `boolean`         | `true`                  | Automatically cache JWT after `verifyChallenge`      |

### Methods

#### Health

| Method      | Returns                        | Description           |
|-------------|--------------------------------|-----------------------|
| `health()`  | `Promise<HealthStatus>`        | Server health check   |

#### Accounts

| Method                                           | Returns                                       | Description                         |
|--------------------------------------------------|-----------------------------------------------|-------------------------------------|
| `accounts.get(publicKey)`                        | `SuccessResponse<AccountInfo>`                | Account details and balances        |
| `accounts.getBalance(publicKey)`                 | `SuccessResponse<BalanceResponse>`            | Native XLM balance                  |
| `accounts.resolveUsername(username)`             | `SuccessResponse<ResolveUsernameResponse>`    | Resolve username to public key      |
| `accounts.register(body)`                        | `SuccessResponse<void>`                       | Register a username                 |

#### Payments

| Method                                              | Returns                                     | Description                    |
|-----------------------------------------------------|---------------------------------------------|--------------------------------|
| `payments.getHistory(publicKey, params?)`           | `SuccessResponse<PaymentRecord[]>`          | Payment history (paginated)    |
| `payments.getStats(publicKey)`                      | `SuccessResponse<PaymentStats>`             | Aggregate payment statistics   |

#### Analytics

| Method                                             | Returns                                      | Description                    |
|----------------------------------------------------|----------------------------------------------|--------------------------------|
| `analytics.getSummary(publicKey)`                  | `SuccessResponse<AnalyticsSummary>`          | Payment summary                |
| `analytics.getTopRecipients(publicKey)`            | `SuccessResponse<TopRecipient[]>`            | Top payment recipients         |
| `analytics.getActivity(publicKey)`                 | `SuccessResponse<ActivityDay[]>`             | Payment activity by day        |

#### Tips

| Method                                          | Returns                              | Description                    |
|-------------------------------------------------|--------------------------------------|--------------------------------|
| `tips.getReceived(creatorPublicKey)`            | `SuccessResponse<Tip[]>`             | Tips received by a creator     |
| `tips.getSent(senderPublicKey)`                 | `SuccessResponse<Tip[]>`             | Tips sent by an account        |
| `tips.getStats(creatorPublicKey)`               | `SuccessResponse<TipStats>`          | Tip statistics                 |
| `tips.create(body)`                             | `SuccessResponse<void>`              | Record a new tip               |

#### Turrets (txFunctions)

| Method                                              | Returns                                      | Description                        |
|-----------------------------------------------------|----------------------------------------------|------------------------------------|
| `turrets.list(params?)`                             | `SuccessResponse<TxFunctionDeployment[]>`    | List deployments (filter by owner) |
| `turrets.createChallenge(body)`                     | `SuccessResponse<TxFunctionChallengeResponse>`| Create a signing challenge         |
| `turrets.deploy(body)`                              | `SuccessResponse<TxFunctionDeployment>`      | Deploy a signed txFunction         |
| `turrets.get(id)`                                   | `SuccessResponse<TxFunctionDeployment>`      | Get a single deployment            |
| `turrets.getHistory(id)`                            | `SuccessResponse<ExecutionLogEntry[]>`       | Execution history                  |
| `turrets.pause(id)`                                 | `SuccessResponse<void>`                      | Pause a deployment                 |
| `turrets.resume(id)`                                | `SuccessResponse<void>`                      | Resume a deployment                |

#### Scheduled Transactions

| Method                                                    | Returns                              | Description                           |
|-----------------------------------------------------------|--------------------------------------|---------------------------------------|
| `scheduledTransactions.schedule(body)`                    | `SuccessResponse<void>`              | Schedule a transaction                |
| `scheduledTransactions.list(publicKey)`                   | `ScheduledTransaction[]`             | List scheduled transactions           |
| `scheduledTransactions.cancel(id)`                        | `SuccessResponse<void>`              | Cancel a scheduled transaction        |

#### SEP-0024

| Method                                              | Returns                            | Description                           |
|-----------------------------------------------------|------------------------------------|---------------------------------------|
| `sep24.initiateDeposit(body)`                       | `Sep24InteractiveResponse`         | Initiate interactive deposit          |
| `sep24.initiateWithdrawal(body)`                    | `Sep24InteractiveResponse`         | Initiate interactive withdrawal       |
| `sep24.getTransaction(id)`                          | `{ transaction: Sep24Transaction }`| Poll transaction status               |

#### AI Parsing

| Method                                    | Returns                              | Description                                 |
|-------------------------------------------|--------------------------------------|---------------------------------------------|
| `parsePayment(body)`                      | `ParsePaymentResponse`               | Parse natural language into payment intent  |

#### Federation

| Method                                                    | Returns                     | Description                           |
|-----------------------------------------------------------|-----------------------------|---------------------------------------|
| `federation.resolve(q, type)`                             | `FederationRecord`          | Resolve stellar address to account ID |
| `federation.getStellarToml()`                             | `string`                    | Get stellar.toml document             |

### Error Handling

The client throws an `ApiHttpError` for non-2xx responses:

```ts
import { ApiHttpError } from "@finchippay/sdk";

try {
  await sdk.accounts.get("INVALID_KEY");
} catch (error) {
  if (error instanceof ApiHttpError) {
    console.error(`HTTP ${error.status}: ${error.message}`);

    // Check rate-limit headers
    if (error.isRateLimited) {
      const rl = error.rateLimit;
      console.log(`Retry after ${rl?.reset} seconds`);
    }
  }
}
```

## Building the SDK

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Regenerate types from OpenAPI spec (requires running backend)
npm run generate:sdk
```

## Development

```bash
# Start the backend (required for type generation)
cd backend && npm start

# In another terminal, regenerate types
npm run generate:sdk

# Build the SDK
npm run build:sdk
```

## License

MIT