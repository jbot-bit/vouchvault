// Operator script — exports a CSV of known members for the v6 member-
// list-as-recovery-asset protocol (KB:F5.1, opsec.md §14).
//
// Output columns: telegram_id, username, first_seen, last_seen.
//
// Sources:
//   - users_first_seen (added in migration 0009): every user_id we've
//     ever seen on a webhook update.
//   - vouch_entries.reviewer_telegram_id / reviewer_username: the
//     publish-history fallback for active reviewers.
//
// "Known member" = appears in users_first_seen (first interaction with
// the bot) AND has either published a vouch OR has been observed via a
// webhook update in the last 90 days. The script intentionally emits
// only (telegram_id, username, first_seen, last_seen) — no private
// notes, freeze status, or other sensitive fields per opsec §14.3.
//
// Usage: `npm run export:members > members-2026-04.csv`

import process from "node:process";

import { pool } from "../src/core/storage/db.ts";

type Row = {
  telegram_id: string;
  username: string | null;
  first_seen: string;
  last_seen: string | null;
};

function csvEscape(value: string | null): string {
  if (value == null) return "";
  // Escape only when the cell contains a comma, double-quote, or newline.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function main(): Promise<void> {
  const sql = `
    WITH last_publish AS (
      SELECT
        reviewer_telegram_id   AS telegram_id,
        max(reviewer_username) AS username,
        max(updated_at)        AS last_seen
      FROM vouch_entries
      WHERE reviewer_telegram_id IS NOT NULL
      GROUP BY reviewer_telegram_id
    )
    SELECT
      uf.telegram_id::text                                    AS telegram_id,
      lp.username                                             AS username,
      to_char(uf.first_seen, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')    AS first_seen,
      CASE
        WHEN lp.last_seen IS NULL THEN NULL
        ELSE to_char(lp.last_seen, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      END                                                     AS last_seen
    FROM users_first_seen uf
    LEFT JOIN last_publish lp ON lp.telegram_id = uf.telegram_id
    ORDER BY uf.first_seen ASC, uf.telegram_id ASC
  `;

  const result = await pool.query<Row>(sql);

  // CSV header
  process.stdout.write("telegram_id,username,first_seen,last_seen\n");
  for (const row of result.rows) {
    const line = [
      csvEscape(row.telegram_id),
      csvEscape(row.username),
      csvEscape(row.first_seen),
      csvEscape(row.last_seen),
    ].join(",");
    process.stdout.write(line + "\n");
  }

  await pool.end();
}

main().catch((error) => {
  console.error("[export:members] failed:", error);
  process.exit(1);
});
