CREATE TABLE IF NOT EXISTS scheduled_transactions (
  id TEXT PRIMARY KEY,
  owner_pk TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  asset TEXT DEFAULT 'XLM',
  memo TEXT,
  frequency TEXT NOT NULL,
  cron_expression TEXT,
  start_date DATE NOT NULL,
  next_run_at TIMESTAMP,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduled_transactions_owner ON scheduled_transactions(owner_pk);
CREATE INDEX IF NOT EXISTS idx_scheduled_transactions_status ON scheduled_transactions(status);

CREATE TABLE IF NOT EXISTS pending_executions (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  owner_pk TEXT NOT NULL,
  unsigned_xdr TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_signature',
  submitted_hash TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_executions_owner ON pending_executions(owner_pk);
CREATE INDEX IF NOT EXISTS idx_pending_executions_schedule ON pending_executions(schedule_id);