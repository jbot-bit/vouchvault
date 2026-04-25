CREATE TABLE "chat_settings" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_at" timestamp,
	"paused_by_telegram_id" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"migrated_to_chat_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
