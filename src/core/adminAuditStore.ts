import { db } from "./storage/db.ts";
import { adminAuditLog } from "./storage/schema.ts";
import { buildAdminAuditRow, type AdminAuditEntry } from "./adminAuditFormat.ts";

export type { AdminAuditEntry } from "./adminAuditFormat.ts";
export { buildAdminAuditRow } from "./adminAuditFormat.ts";

export async function recordAdminAction(entry: AdminAuditEntry): Promise<void> {
  await db.insert(adminAuditLog).values(buildAdminAuditRow(entry));
}
