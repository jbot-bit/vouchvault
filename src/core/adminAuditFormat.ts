// Pure row-building for admin audit-log inserts. Lives in its own module so
// the helper can be unit-tested without booting the DB pool.

export type AdminAuditEntry = {
  adminTelegramId: number;
  adminUsername?: string | null;
  command: string;
  targetChatId?: number | null;
  targetUsername?: string | null;
  entryId?: number | null;
  reason?: string | null;
  denied?: boolean;
};

export function buildAdminAuditRow(entry: AdminAuditEntry) {
  return {
    adminTelegramId: entry.adminTelegramId,
    adminUsername: entry.adminUsername ?? null,
    command: entry.command,
    targetChatId: entry.targetChatId ?? null,
    targetUsername: entry.targetUsername ?? null,
    entryId: entry.entryId ?? null,
    reason: entry.reason ?? null,
    denied: entry.denied ?? false,
  };
}
