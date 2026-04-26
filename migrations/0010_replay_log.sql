-- v6 §4.5 / commit 7: mass-forward replay idempotency log.
--
-- The replay script (scripts/replayToTelegramAsForwards.ts) calls Bot
-- API forwardMessages to relay archived channel posts into a new
-- destination chat (e.g. recovery supergroup post-takedown). Each
-- successful forward writes one row here; reruns of the same run_id +
-- source coordinates skip already-forwarded messages so the operation
-- is safe to resume after a crash or rate-limit timeout.

CREATE TABLE IF NOT EXISTS replay_log (
  id BIGSERIAL PRIMARY KEY,
  replay_run_id UUID NOT NULL,
  source_chat_id BIGINT NOT NULL,
  source_message_id INTEGER NOT NULL,
  destination_chat_id BIGINT NOT NULL,
  destination_message_id INTEGER,
  replayed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency unique. Composite key allows the same source message to
-- be replayed into multiple destinations (e.g. recovery + sister
-- group seeding) but blocks duplicate forwards within the same run.
CREATE UNIQUE INDEX IF NOT EXISTS replay_log_run_source_dest_unique
  ON replay_log (replay_run_id, source_chat_id, source_message_id, destination_chat_id);

-- Lookup index for "what have we already forwarded into <destination>?"
-- used by resume-after-crash logic.
CREATE INDEX IF NOT EXISTS replay_log_destination_idx
  ON replay_log (destination_chat_id, replayed_at);
