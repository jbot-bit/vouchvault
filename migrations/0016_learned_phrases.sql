-- 2026-05: live-trainable lexicon. /teach <phrase> in the group writes
-- a row here; /untrain or the inline button on /learned soft-deletes
-- it. chatModeration loads the active set on each hit (60s in-mem
-- cache) and checks it after the static PHRASES list.
--
-- Soft delete: removed_at IS NOT NULL hides the phrase from moderation
-- without losing audit. The unique index is partial so a phrase can
-- be re-added after removal without violating uniqueness.

CREATE TABLE IF NOT EXISTS learned_phrases (
  id BIGSERIAL PRIMARY KEY,
  phrase_normalized TEXT NOT NULL,
  phrase_raw TEXT NOT NULL,
  added_by_telegram_id BIGINT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by_telegram_id BIGINT
);

-- Active phrases must be unique on the normalized form; removed rows
-- are kept for audit and don't participate in uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS learned_phrases_active_unique
  ON learned_phrases (phrase_normalized)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS learned_phrases_active_idx
  ON learned_phrases (added_at DESC)
  WHERE removed_at IS NULL;
