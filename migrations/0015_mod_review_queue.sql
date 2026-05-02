-- 2026-05: admin-curated review queue.
--
-- When an admin replies to a group message with /teach, the bot adds a
-- row here instead of deleting. Admin later DMs /reviewq to scan
-- pending items + decide keep/delete per row. Lets the operator catch
-- borderline messages the lexicon missed without giving the bot
-- judgement-call autonomy.
--
-- Idempotency: unique on (group_chat_id, group_message_id) so a
-- repeated /teach on the same message is a no-op.

CREATE TABLE IF NOT EXISTS mod_review_queue (
  id BIGSERIAL PRIMARY KEY,
  group_chat_id BIGINT NOT NULL,
  group_message_id BIGINT NOT NULL,
  sender_telegram_id BIGINT,
  sender_username TEXT,
  message_text TEXT,
  flagged_by_telegram_id BIGINT NOT NULL,
  flagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by_telegram_id BIGINT,
  decided_at TIMESTAMPTZ,
  decision TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS mod_review_queue_source_unique
  ON mod_review_queue (group_chat_id, group_message_id);

-- "Pending items" hot path: queue listing with decision IS NULL.
CREATE INDEX IF NOT EXISTS mod_review_queue_pending_idx
  ON mod_review_queue (flagged_at DESC)
  WHERE decision IS NULL;
