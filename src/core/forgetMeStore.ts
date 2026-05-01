// DB-bound deps for /forgetme. Split from forgetMe.ts so the pure
// state-machine + copy module stays unit-testable without DATABASE_URL,
// mirroring the mirrorPublish ↔ mirrorStore split.

import { sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import {
  users,
  usersFirstSeen,
  vouchDrafts,
  vouchEntries,
} from "./storage/schema.ts";
import { recordAdminAction } from "./adminAuditStore.ts";
import type { ForgetDeps } from "./forgetMe.ts";

export function defaultForgetDeps(): ForgetDeps {
  return {
    async deleteVouchEntries({ userId }) {
      // Reviewer-side only. Vouches written ABOUT this user by other
      // members are not "their" data — wiping them would let a scammer
      // /forgetme away every NEG about themselves and turn the bot into
      // a launder-your-rep service. That's a community-trust failure
      // and a "complicit bot" report vector.
      const result = await db
        .delete(vouchEntries)
        .where(sql`${vouchEntries.reviewerTelegramId} = ${userId}`);
      return Number(result.rowCount ?? 0);
    },
    async deleteVouchDrafts(userId) {
      const result = await db
        .delete(vouchDrafts)
        .where(sql`${vouchDrafts.reviewerTelegramId} = ${userId}`);
      return Number(result.rowCount ?? 0);
    },
    async deleteUsersFirstSeen(userId) {
      const result = await db
        .delete(usersFirstSeen)
        .where(sql`${usersFirstSeen.telegramId} = ${userId}`);
      return Number(result.rowCount ?? 0);
    },
    async deleteUsers(userId) {
      const result = await db
        .delete(users)
        .where(sql`${users.telegramId} = ${userId}`);
      return Number(result.rowCount ?? 0);
    },
    async audit({ userId, username }) {
      await recordAdminAction({
        adminTelegramId: userId,
        adminUsername: username,
        command: "/forgetme",
        targetChatId: null,
        targetUsername: username,
        denied: false,
      });
    },
  };
}
