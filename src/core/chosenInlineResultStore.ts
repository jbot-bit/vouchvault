// Inline-cards phase 2: persist chosen_inline_result events.
//
// Telegram fires `chosen_inline_result` when a user picks an inline
// result and Telegram inserts it into a chat. We log target_username
// + content_hash so the future v2 edit-watcher can compare a
// post-edit body hash against what we originally rendered.
//
// v1 writes only — nothing reads. Phase 3's /forgetme TODO must
// purge these rows for the requesting user.

import { db } from "./storage/db.ts";
import { chosenInlineResults } from "./storage/schema.ts";

export async function recordChosenInlineResult(input: {
  userId: number;
  targetUsername: string;
  contentHash: string;
}): Promise<void> {
  await db.insert(chosenInlineResults).values({
    userId: input.userId,
    targetUsername: input.targetUsername,
    contentHash: input.contentHash,
  });
}
