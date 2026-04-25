ALTER TABLE vouch_entries
ADD CONSTRAINT vouch_entries_status_check
CHECK (status IN ('pending', 'publishing', 'published', 'removed'));
