import { db } from "./storage/db.ts";
import { adminAuditLog } from "./storage/schema.ts";

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

export async function recordAdminAction(entry: AdminAuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values({
    adminTelegramId: entry.adminTelegramId,
    adminUsername: entry.adminUsername ?? null,
    command: entry.command,
    targetChatId: entry.targetChatId ?? null,
    targetUsername: entry.targetUsername ?? null,
    entryId: entry.entryId ?? null,
    reason: entry.reason ?? null,
    denied: entry.denied ?? false,
  });
}
