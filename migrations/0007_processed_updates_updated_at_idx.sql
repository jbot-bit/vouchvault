-- runArchiveMaintenance scans processed_telegram_updates by updated_at on
-- every Nth webhook to garbage-collect rows older than the retention window.
-- Without an index this is a sequential scan; on a busy deployment after a
-- few weeks of traffic the table grows large enough that the scan exceeds
-- the pool's statement_timeout (20s) and the maintenance call silently no-ops
-- forever, letting the table balloon further.
CREATE INDEX IF NOT EXISTS "processed_telegram_updates_updated_at_idx"
  ON "processed_telegram_updates" USING btree ("updated_at");
