CREATE TABLE "admin_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"admin_telegram_id" bigint NOT NULL,
	"admin_username" text,
	"command" text NOT NULL,
	"target_chat_id" bigint,
	"target_username" text,
	"entry_id" integer,
	"reason" text,
	"denied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
