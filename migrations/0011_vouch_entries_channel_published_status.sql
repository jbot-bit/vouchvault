-- Migration 0009 added channel_message_id + body_text columns for the v6
-- channel-relay path but missed extending the status CHECK constraint
-- introduced in 0006. The V3.5 state machine adds 'channel_published'
-- (channel post written, awaiting auto-forward capture into the
-- supergroup); without this migration any UPDATE setting that status
-- gets rejected by Postgres and the /healthz stale-relay-rows probe
-- silently always returns 0.
--
-- Drop + re-add the CHECK with the extended set. No data backfill
-- needed — existing rows are pending/publishing/published/removed and
-- all four remain valid.

ALTER TABLE vouch_entries
  DROP CONSTRAINT IF EXISTS vouch_entries_status_check;

ALTER TABLE vouch_entries
  ADD CONSTRAINT vouch_entries_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'channel_published', 'removed'));
