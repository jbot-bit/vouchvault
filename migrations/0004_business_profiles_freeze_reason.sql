ALTER TABLE "business_profiles" ADD COLUMN "freeze_reason" text;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "frozen_at" timestamp;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "frozen_by_telegram_id" bigint;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "telegram_id" bigint;