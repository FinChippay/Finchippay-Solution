# GraphQL Persisted Operations (#630)

## What this is

Persisted operations (a.k.a. "trusted documents") is an optional hardening
mode for the GraphQL API at `/api/graphql`. When enabled, the server refuses
to execute any query whose text isn't pre-registered in a manifest — it
doesn't matter if the query is syntactically valid, within the depth/
complexity limits, and requests only fields the client is authorized to see.
If it's not in the manifest, it's rejected with a `PERSISTED_OPERATION_NOT_FOUND`
error before any resolver runs.

This closes off arbitrary-query attacks entirely for clients that adopt it:
a caller can no longer probe the API with hand-crafted queries, even ones
that would otherwise pass every other check. The trade-off is operational —
every query the web client uses has to be published to the manifest ahead of
time, and an unpublished query (e.g. one added in a client release that
hasn't shipped the updated manifest yet) will fail.

It's off by default. Ad-hoc queries work exactly as before until a client
opts in.

## Enabling it

```bash
GRAPHQL_PERSISTED_OPERATIONS_ONLY=true
GRAPHQL_PERSISTED_OPERATIONS_MANIFEST=./src/graphql/persisted-operations.json  # optional, this is the default
```

The manifest is a JSON object mapping a query's SHA-256 hash (hex-encoded, of
the trimmed query text) to the query text itself:

```json
{
  "3a7bd3e2360a3d...": "query Account($publicKey: String!) { account(publicKey: $publicKey) { publicKey } }"
}
```

`src/graphql/persistedOperations.js` exports `hashQuery(query)` — use it to
generate manifest entries so hashing stays consistent with what the server
computes at request time.

## Workflow for the web client

This backend enforces the manifest; generating it from the client's actual
queries is a client-side build step (out of scope for this backend PR, but
outlined here so it's a drop-in follow-up):

1. During the web client's build, extract every GraphQL document it sends
   (e.g. via `graphql-tag` template literals or `.graphql` files).
2. For each one, compute `sha256(trim(queryText))` and write
   `{ [hash]: queryText }` into a manifest file.
3. Ship that manifest to the backend deployment (e.g. as a build artifact or
   committed file) and point `GRAPHQL_PERSISTED_OPERATIONS_MANIFEST` at it.
4. Have the client send the hash via the standard Automated Persisted
   Queries `extensions.persistedQuery.sha256Hash` convention, or simply keep
   sending full query text — the server hashes whatever text it receives and
   checks it against the manifest either way, so no client-side protocol
   change is strictly required to turn this on.

## Recommended rollout

- Keep it disabled until the manifest-generation step above exists for the
  web client — enabling it without a manifest workflow will reject every
  request.
- Enable it first in a staging environment against the real manifest to
  confirm no queries are missing.
- In production, treat manifest publishing as part of the client's release
  process: a client release and its manifest update should ship together.
