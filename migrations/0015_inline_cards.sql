-- Inline vouch cards phase 0: schema additions for the SC45 member
-- registry, the forgery-strikes audit table, the chosen_inline_results
-- capture table, and the via_bot_id column on mirror_log.
--
-- See docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md
-- and docs/superpowers/plans/2026-05-01-inline-vouch-cards.md.

CREATE TABLE IF NOT EXISTS sc45_members (
  user_id BIGINT PRIMARY KEY,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forgery_strikes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS forgery_strikes_user_recent
  ON forgery_strikes (user_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS chosen_inline_results (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  target_username TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chosen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chosen_inline_results_recent
  ON chosen_inline_results (user_id, chosen_at DESC);

ALTER TABLE mirror_log
  ADD COLUMN IF NOT EXISTS via_bot_id BIGINT;
