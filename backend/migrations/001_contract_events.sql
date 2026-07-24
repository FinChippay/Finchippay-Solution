-- 001_contract_events.sql
-- Contract event indexer schema for Finchippay Solution.
--
-- Stores every Soroban event emitted by FinchippayContract so the
-- dashboard and API can surface streaming, escrow, and multi-sig
-- activity alongside regular Horizon payment history.

CREATE TABLE IF NOT EXISTS contract_events (
    id              SERIAL PRIMARY KEY,
    event_type      VARCHAR(64)   NOT NULL,
    contract_id     VARCHAR(64)   NOT NULL,
    ledger_sequence INTEGER       NOT NULL,
    emitted_at      TIMESTAMPTZ   NOT NULL,
    payload         JSONB         NOT NULL,
    created_at      TIMESTAMPTZ   DEFAULT NOW()
);

-- Composite index for event-type + ledger-range queries (dashboard stats)
CREATE INDEX IF NOT EXISTS idx_events_type_ledger
    ON contract_events (event_type, ledger_sequence);

-- GIN index on the payload column so participant-lookup queries
-- (payload->>'from' / payload->>'to') are index-assisted.
CREATE INDEX IF NOT EXISTS idx_events_payload
    ON contract_events USING GIN (payload);

-- Unique constraint to prevent duplicate indexing on restart.
-- Soroban events are uniquely identified by (ledger_sequence, contract_id, event_type)
-- plus the first two topic values which typically encode the key participants.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup
    ON contract_events (ledger_sequence, contract_id, event_type, (payload->>'id'));
