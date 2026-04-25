import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  bigint,
  index,
  unique,
  uniqueIndex,
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

export const processedTelegramUpdates = pgTable("processed_telegram_updates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  updateId: bigint("update_id", { mode: "number" }).notNull().unique(),
  status: text("status").notNull().default("processing"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
