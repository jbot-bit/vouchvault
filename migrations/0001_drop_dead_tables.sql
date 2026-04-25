DROP TABLE "polls" CASCADE;--> statement-breakpoint
DROP TABLE "votes" CASCADE;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "total_yes_votes";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "total_no_votes";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "rank";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "stars";