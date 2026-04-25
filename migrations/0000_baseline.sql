CREATE TABLE "business_profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "business_profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_profiles_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "chat_launchers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chat_launchers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chat_id" bigint NOT NULL,
	"message_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_launchers_chat_id_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "polls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_poll_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"chat_id" bigint NOT NULL,
	"poll_message_id" integer NOT NULL,
	"card_message_id" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_bumped_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "polls_telegram_poll_id_unique" UNIQUE("telegram_poll_id")
);
--> statement-breakpoint
CREATE TABLE "processed_telegram_updates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "processed_telegram_updates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"update_id" bigint NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "processed_telegram_updates_update_id_unique" UNIQUE("update_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"telegram_id" bigint NOT NULL,
	"username" text,
	"first_name" text,
	"last_name" text,
	"total_yes_votes" integer DEFAULT 0 NOT NULL,
	"total_no_votes" integer DEFAULT 0 NOT NULL,
	"rank" text DEFAULT '🚫 Unverified' NOT NULL,
	"stars" text DEFAULT '⭐' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "votes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"poll_id" integer NOT NULL,
	"voter_id" integer NOT NULL,
	"vote_value" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "votes_poll_id_voter_id_unique" UNIQUE("poll_id","voter_id")
);
--> statement-breakpoint
CREATE TABLE "vouch_drafts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vouch_drafts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reviewer_telegram_id" bigint NOT NULL,
	"reviewer_username" text,
	"reviewer_first_name" text,
	"private_chat_id" bigint NOT NULL,
	"target_group_chat_id" bigint,
	"target_username" text,
	"entry_type" text,
	"result" text,
	"selected_tags" text DEFAULT '[]' NOT NULL,
	"step" text DEFAULT 'awaiting_target' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vouch_drafts_reviewer_telegram_id_unique" UNIQUE("reviewer_telegram_id")
);
--> statement-breakpoint
CREATE TABLE "vouch_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vouch_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reviewer_user_id" integer,
	"reviewer_telegram_id" bigint NOT NULL,
	"reviewer_username" text NOT NULL,
	"target_profile_id" integer NOT NULL,
	"target_username" text NOT NULL,
	"chat_id" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"result" text NOT NULL,
	"selected_tags" text DEFAULT '[]' NOT NULL,
	"source" text DEFAULT 'live' NOT NULL,
	"legacy_source_message_id" integer,
	"legacy_source_chat_id" bigint,
	"legacy_source_timestamp" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"published_message_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouch_entries" ADD CONSTRAINT "vouch_entries_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouch_entries" ADD CONSTRAINT "vouch_entries_target_profile_id_business_profiles_id_fk" FOREIGN KEY ("target_profile_id") REFERENCES "public"."business_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vouch_entries_reviewer_target_created_idx" ON "vouch_entries" USING btree ("reviewer_telegram_id","target_username","created_at");--> statement-breakpoint
CREATE INDEX "vouch_entries_target_status_created_idx" ON "vouch_entries" USING btree ("target_username","status","created_at");--> statement-breakpoint
CREATE INDEX "vouch_entries_status_created_idx" ON "vouch_entries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vouch_entries_legacy_source_unique" ON "vouch_entries" USING btree ("legacy_source_chat_id","legacy_source_message_id");