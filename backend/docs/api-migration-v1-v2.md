# API Migration Guide: Unversioned → v1

## Overview

This guide documents the migration from unversioned API endpoints to versioned
endpoints (`/api/v1/...`). The Finchippay API now uses URL-prefix versioning
to ensure backward compatibility as new features are added.

## Why Versioning?

As the API evolves, breaking changes may need to be introduced. Without
versioning, existing clients (merchant integrations, SDK users) would break
on deployment. URL-prefix versioning allows multiple API versions to coexist,
giving clients time to migrate.

## Changes

### New URL Structure

| Old (unversioned)    | New (v1)                | Status |
| -------------------- | ----------------------- | ------ |
| `/api/auth`          | `/api/v1/auth`          | Active |
| `/api/accounts`      | `/api/v1/accounts`      | Active |
| `/api/payments`      | `/api/v1/payments`      | Active |
| `/api/receipts`      | `/api/v1/receipts`      | Active |
| `/api/webhooks`      | `/api/v1/webhooks`      | Active |
| `/api/analytics`     | `/api/v1/analytics`     | Active |
| `/api/turrets`       | `/api/v1/turrets`       | Active |
| `/api/tips`          | `/api/v1/tips`          | Active |
| `/api/notifications` | `/api/v1/notifications` | Active |
| `/api/push`          | `/api/v1/push`          | Active |
| `/api/events`        | `/api/v1/events`        | Active |
| `/api/health`        | `/api/v1/health`        | Active |
| `/api/docs`          | `/api/v1/docs`          | Active |
| `/api/sep24`         | `/api/v1/sep24`         | Active |
| `/api/sep12`         | `/api/v1/sep12`         | Active |
| `/api/features`      | `/api/v1/features`      | Active |
| `/api/tokens`        | `/api/v1/tokens`        | Active |

### Response Headers

All responses now include:

- `X-API-Version`: The version of the API handling the request
- `X-API-Deprecated`: `true` if the version is deprecated (only on unversioned
  endpoints)

### Request Headers

Clients can specify a preferred API version via the `Accept-Version` header:

```
Accept-Version: 1
```

## Migration Checklist

### For SDK Users

1. Update the SDK to version 1.1.0 or later
2. If using the SDK constructor, no changes needed — the SDK defaults to v1
3. To pin a specific version:
   ```ts
   const client = new FinchippayClient({
     apiVersion: "1",
     // ...
   });
   ```

### For Direct API Users

1. Replace `/api/` with `/api/v1/` in all request URLs
2. Add `Accept-Version: 1` header to all requests
3. Monitor `X-API-Deprecated` headers in responses
4. Listen for `Sunset` headers indicating version removal dates

## Example: Upgrading SDK from v0 to v1

### Before (unversioned)

```ts
import { FinchippayClient } from "@finchippay/sdk";

const client = new FinchippayClient({
  baseUrl: "https://api.finchippay.io",
});
const payments = await client.payments.getHistory("G...");
```

### After (versioned, no code changes needed)

```ts
import { FinchippayClient } from "@finchippay/sdk";

const client = new FinchippayClient({
  baseUrl: "https://api.finchippay.io",
  // apiVersion defaults to '1'
});
const payments = await client.payments.getHistory("G...");
```

## Timelines

| Version | Release Date | Deprecation Date | Sunset Date |
| ------- | ------------ | ---------------- | ----------- |
| v1      | 2026-01-15   | TBD              | TBD         |

## Need Help?

- [API Documentation](/api/v1/docs)
- [SDK Reference](/sdk)
- [GitHub Issues](https://github.com/FinChippay/Finchippay-Solution/issues)
