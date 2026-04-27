import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  bigint,
  bigserial,
  index,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});


export const businessProfiles = pgTable("business_profiles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  username: text("username").notNull().unique(),
  isFrozen: boolean("is_frozen").notNull().default(false),
  freezeReason: text("freeze_reason"),
  frozenAt: timestamp("frozen_at"),
  frozenByTelegramId: bigint("frozen_by_telegram_id", { mode: "number" }),
  telegramId: bigint("telegram_id", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const vouchDrafts = pgTable("vouch_drafts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  reviewerTelegramId: bigint("reviewer_telegram_id", { mode: "number" }).notNull().unique(),
  reviewerUsername: text("reviewer_username"),
  reviewerFirstName: text("reviewer_first_name"),
  privateChatId: bigint("private_chat_id", { mode: "number" }).notNull(),
  targetGroupChatId: bigint("target_group_chat_id", { mode: "number" }),
  targetUsername: text("target_username"),
  entryType: text("entry_type"),
  result: text("result"),
  selectedTags: text("selected_tags").notNull().default("[]"),
  step: text("step").notNull().default("awaiting_target"),
  privateNote: text("private_note"),
  bodyText: text("body_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const vouchEntries = pgTable(
  "vouch_entries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    reviewerUserId: integer("reviewer_user_id").references(() => users.id),
    reviewerTelegramId: bigint("reviewer_telegram_id", { mode: "number" }).notNull(),
    reviewerUsername: text("reviewer_username").notNull(),
    targetProfileId: integer("target_profile_id")
      .notNull()
      .references(() => businessProfiles.id),
    targetUsername: text("target_username").notNull(),
    targetTelegramId: bigint("target_telegram_id", { mode: "number" }),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    entryType: text("entry_type").notNull(),
    result: text("result").notNull(),
    selectedTags: text("selected_tags").notNull().default("[]"),
    source: text("source").notNull().default("live"),
    legacySourceMessageId: integer("legacy_source_message_id"),
    legacySourceChatId: bigint("legacy_source_chat_id", { mode: "number" }),
    legacySourceTimestamp: timestamp("legacy_source_timestamp"),
    status: text("status").notNull().default("pending"),
    publishedMessageId: integer("published_message_id"),
    channelMessageId: integer("channel_message_id"),
    bodyText: text("body_text"),
    privateNote: text("private_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => {
    return {
      reviewerTargetCreatedIdx: index("vouch_entries_reviewer_target_created_idx").on(
        table.reviewerTelegramId,
        table.targetUsername,
        table.createdAt,
      ),
      targetStatusCreatedIdx: index("vouch_entries_target_status_created_idx").on(
        table.targetUsername,
        table.status,
        table.createdAt,
      ),
      statusCreatedIdx: index("vouch_entries_status_created_idx").on(table.status, table.createdAt),
      legacySourceUniqueIdx: uniqueIndex("vouch_entries_legacy_source_unique").on(
        table.legacySourceChatId,
        table.legacySourceMessageId,
      ),
    };
  },
);

export const chatLaunchers = pgTable("chat_launchers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  chatId: bigint("chat_id", { mode: "number" }).notNull().unique(),
  messageId: integer("message_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const processedTelegramUpdates = pgTable(
  "processed_telegram_updates",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    updateId: bigint("update_id", { mode: "number" }).notNull(),
    botKind: text("bot_kind").notNull().default("ingest"),
    status: text("status").notNull().default("processing"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => {
    return {
      botKindUpdateIdUnique: unique("processed_telegram_updates_bot_kind_update_id_unique").on(
        table.botKind,
        table.updateId,
      ),
    };
  },
);

export const usersFirstSeen = pgTable("users_first_seen", {
  telegramId: bigint("telegram_id", { mode: "number" }).primaryKey(),
  firstSeen: timestamp("first_seen").notNull().defaultNow(),
});

export const replayLog = pgTable(
  "replay_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    replayRunId: uuid("replay_run_id").notNull(),
    sourceChatId: bigint("source_chat_id", { mode: "number" }).notNull(),
    sourceMessageId: integer("source_message_id").notNull(),
    destinationChatId: bigint("destination_chat_id", { mode: "number" }).notNull(),
    destinationMessageId: integer("destination_message_id"),
    replayedAt: timestamp("replayed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => {
    return {
      runSourceDestUnique: uniqueIndex("replay_log_run_source_dest_unique").on(
        table.replayRunId,
        table.sourceChatId,
        table.sourceMessageId,
        table.destinationChatId,
      ),
      destinationIdx: index("replay_log_destination_idx").on(
        table.destinationChatId,
        table.replayedAt,
      ),
    };
  },
);

export const chatSettings = pgTable("chat_settings", {
  chatId: bigint("chat_id", { mode: "number" }).primaryKey(),
  paused: boolean("paused").notNull().default(false),
  pausedAt: timestamp("paused_at"),
  pausedByTelegramId: bigint("paused_by_telegram_id", { mode: "number" }),
  status: text("status").notNull().default("active"),
  migratedToChatId: bigint("migrated_to_chat_id", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const adminAuditLog = pgTable("admin_audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  adminTelegramId: bigint("admin_telegram_id", { mode: "number" }).notNull(),
  adminUsername: text("admin_username"),
  command: text("command").notNull(),
  targetChatId: bigint("target_chat_id", { mode: "number" }),
  targetUsername: text("target_username"),
  entryId: integer("entry_id"),
  reason: text("reason"),
  denied: boolean("denied").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// v8.0 commit 3 (U2): per-distribution one-shot invite links. Bot mints
// the link via Bot API createChatInviteLink (member_limit:1 + expire_date
// set as a Unix-seconds integer); Telegram auto-revokes after first use.
// The bot captures chat_join_request updates and stamps
// used_by_telegram_id + used_at on the matching row. Migration 0013
// adds the table.
//
// Bot API spec (snapshot 11344): expire_date is Unix-seconds integer.
// We store as TIMESTAMPTZ in the DB for human readability — conversion
// happens at the API boundary in inviteLinks.ts.
export const inviteLinks = pgTable("invite_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  link: text("link").notNull().unique(),
  memberLimit: integer("member_limit"),
  expireDate: timestamp("expire_date", { withTimezone: true }),
  name: text("name"),
  createdByTelegramId: bigint("created_by_telegram_id", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedByTelegramId: bigint("used_by_telegram_id", { mode: "number" }),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

