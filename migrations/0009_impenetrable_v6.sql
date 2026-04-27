-- v6 impenetrable architecture — schema additions for channel relay,
-- multi-bot idempotency, and account-age guard.

-- §V3.5.4 channel relay: capture the channel-side message id so the
-- channel + supergroup ids both live on the row. body_text holds the
-- free-form prose body for the published shape (V3.5.2). Both nullable
-- for backwards compat with existing rows that pre-date relay.
ALTER TABLE vouch_entries
  ADD COLUMN channel_message_id INTEGER;

ALTER TABLE vouch_entries
  ADD COLUMN body_text TEXT;

-- §10.3 multi-bot idempotency: Telegram update_ids are per-bot, so three
-- bots = three independent sequences. Drop the single-column unique on
-- update_id and replace with composite (bot_kind, update_id). Existing
-- rows are stamped 'ingest' by the NOT NULL DEFAULT.
ALTER TABLE processed_telegram_updates
  ADD COLUMN bot_kind TEXT NOT NULL DEFAULT 'ingest';

ALTER TABLE processed_telegram_updates
  DROP CONSTRAINT IF EXISTS processed_telegram_updates_update_id_unique;

ALTER TABLE processed_telegram_updates
  ADD CONSTRAINT processed_telegram_updates_bot_kind_update_id_unique
  UNIQUE (bot_kind, update_id);

-- §V3.5.3 account-age guard: 24h floor before a user can submit a vouch.
-- first_seen is set on the first webhook update we ever see from this
-- telegram_id (markUpdateProcessed writes it via ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS users_first_seen (
  telegram_id BIGINT PRIMARY KEY,
  first_seen TIMESTAMP NOT NULL DEFAULT NOW()
);
