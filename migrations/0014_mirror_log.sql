-- v9 phase 1: backup-channel mirror idempotency log.
--
-- When VV_MIRROR_ENABLED=true, every member-posted message in an allowed
-- group is forwarded to TELEGRAM_CHANNEL_ID via Bot API forwardMessage.
-- One row per successful forward; the unique constraint on (group_chat_id,
-- group_message_id) prevents duplicate forwards on webhook retries.

CREATE TABLE IF NOT EXISTS mirror_log (
  id BIGSERIAL PRIMARY KEY,
  group_chat_id BIGINT NOT NULL,
  group_message_id BIGINT NOT NULL,
  channel_chat_id BIGINT NOT NULL,
  channel_message_id BIGINT NOT NULL,
  forwarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency unique. One forward per (source group, source message)
-- regardless of channel id, since a single message should only ever be
-- mirrored once. If the operator changes TELEGRAM_CHANNEL_ID mid-flight,
-- post-change messages mirror to the new channel; pre-change messages
-- stay where they were.
CREATE UNIQUE INDEX IF NOT EXISTS mirror_log_source_unique
  ON mirror_log (group_chat_id, group_message_id);

-- Lookup index for "when did we last mirror" / health check surface.
CREATE INDEX IF NOT EXISTS mirror_log_forwarded_at_idx
  ON mirror_log (forwarded_at DESC);
