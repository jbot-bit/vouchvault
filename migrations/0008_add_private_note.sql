ALTER TABLE vouch_entries
  ADD COLUMN private_note TEXT;

ALTER TABLE vouch_drafts
  ADD COLUMN private_note TEXT;
