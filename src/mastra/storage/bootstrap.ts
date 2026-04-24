import { pool } from "./db.ts";

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id bigint NOT NULL UNIQUE,
  username text,
  first_name text,
  last_name text,
  total_yes_votes integer NOT NULL DEFAULT 0,
  total_no_votes integer NOT NULL DEFAULT 0,
  rank text NOT NULL DEFAULT '🚫 Unverified',
  stars text NOT NULL DEFAULT '⭐',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS polls (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_poll_id text NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id),
  chat_id bigint NOT NULL,
  poll_message_id integer NOT NULL,
  card_message_id integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  last_bumped_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS votes (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  poll_id integer NOT NULL REFERENCES polls(id),
  voter_id integer NOT NULL REFERENCES users(id),
  vote_value boolean NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT votes_poll_id_voter_id_unique UNIQUE (poll_id, voter_id)
);

CREATE TABLE IF NOT EXISTS business_profiles (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL UNIQUE,
  is_frozen boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouch_drafts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewer_telegram_id bigint NOT NULL UNIQUE,
  reviewer_username text,
  reviewer_first_name text,
  private_chat_id bigint NOT NULL,
  target_group_chat_id bigint,
  target_username text,
  entry_type text,
  result text,
  selected_tags text NOT NULL DEFAULT '[]',
  step text NOT NULL DEFAULT 'awaiting_target',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouch_entries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reviewer_user_id integer REFERENCES users(id),
  reviewer_telegram_id bigint NOT NULL,
  reviewer_username text NOT NULL,
  target_profile_id integer NOT NULL REFERENCES business_profiles(id),
  target_username text NOT NULL,
  chat_id bigint NOT NULL,
  entry_type text NOT NULL,
  result text NOT NULL,
  selected_tags text NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'live',
  legacy_source_message_id integer,
  legacy_source_chat_id bigint,
  legacy_source_timestamp timestamp,
  status text NOT NULL DEFAULT 'pending',
  published_message_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_launchers (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id bigint NOT NULL UNIQUE,
  message_id integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_telegram_updates (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  update_id bigint NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'processing',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vouch_entries_reviewer_target_created_idx
  ON vouch_entries (reviewer_telegram_id, target_username, created_at);

CREATE INDEX IF NOT EXISTS vouch_entries_target_status_created_idx
  ON vouch_entries (target_username, status, created_at);

CREATE INDEX IF NOT EXISTS vouch_entries_status_created_idx
  ON vouch_entries (status, created_at);

ALTER TABLE IF EXISTS vouch_drafts
  ADD COLUMN IF NOT EXISTS target_group_chat_id bigint;

ALTER TABLE IF EXISTS vouch_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live';

ALTER TABLE IF EXISTS vouch_entries
  ADD COLUMN IF NOT EXISTS legacy_source_message_id integer;

ALTER TABLE IF EXISTS vouch_entries
  ADD COLUMN IF NOT EXISTS legacy_source_chat_id bigint;

ALTER TABLE IF EXISTS vouch_entries
  ADD COLUMN IF NOT EXISTS legacy_source_timestamp timestamp;

ALTER TABLE IF EXISTS vouch_entries
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE IF EXISTS vouch_entries
  ADD COLUMN IF NOT EXISTS published_message_id integer;

ALTER TABLE IF EXISTS vouch_entries
  ALTER COLUMN status SET DEFAULT 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS vouch_entries_legacy_source_unique
  ON vouch_entries (legacy_source_chat_id, legacy_source_message_id);
`;

let bootstrapPromise: Promise<void> | null = null;

export async function ensureDatabaseSchema(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = pool.query(BOOTSTRAP_SQL).then(() => undefined);
  }

  return bootstrapPromise;
}
