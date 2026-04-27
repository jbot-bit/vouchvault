-- V3.5.2 / v6 commit 5b: store the free-form prose body on the in-flight
-- draft so it survives the wizard's preview→confirm step. Promoted to
-- vouch_entries.body_text on confirm. Nullable so existing draft rows
-- mid-flight at deploy time aren't invalidated; the new
-- 'awaiting_prose' step is the only writer.
ALTER TABLE vouch_drafts
  ADD COLUMN body_text TEXT;
