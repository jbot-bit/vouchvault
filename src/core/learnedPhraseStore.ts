// DB ops for the live-trainable lexicon. /teach <phrase> calls
// `addLearnedPhrase`; /untrain + the /learned remove-button call
// `removeLearnedPhrase`. Moderation reads via `getActiveLearnedPhrasesCached`
// — a tiny in-memory TTL cache so we don't hit Postgres on every group
// message. Cache is invalidated immediately after add/remove so admin
// edits take effect on the next message, not after the TTL elapses.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./storage/db.ts";
import { learnedPhrases } from "./storage/schema.ts";
import {
  normalize,
  validateLearnedPhrase,
} from "./chatModerationLexicon.ts";

export { validateLearnedPhrase } from "./chatModerationLexicon.ts";

export type LearnedPhrase = {
  id: number;
  phraseNormalized: string;
  phraseRaw: string;
  addedByTelegramId: number;
  addedAt: Date;
};

export type AddResult =
  | { ok: true; id: number; alreadyActive: false; phraseNormalized: string }
  | { ok: true; id: number; alreadyActive: true; phraseNormalized: string }
  | {
      ok: false;
      reason: "too_short" | "no_letters" | "too_long" | "too_broad";
    };

const MIN_NORMALIZED_LEN = 3;

export async function addLearnedPhrase(input: {
  rawPhrase: string;
  addedByTelegramId: number;
}): Promise<AddResult> {
  const v = validateLearnedPhrase(input.rawPhrase);
  if (!v.ok) return { ok: false, reason: v.reason };

  // Check for existing active row first (the partial unique index would
  // also catch this on insert, but we want a clean "alreadyActive" result
  // without relying on error-catching).
  const existing = await db
    .select({ id: learnedPhrases.id })
    .from(learnedPhrases)
    .where(
      and(
        eq(learnedPhrases.phraseNormalized, v.normalized),
        isNull(learnedPhrases.removedAt),
      ),
    )
    .limit(1);
  if (existing[0]) {
    return {
      ok: true,
      id: existing[0].id,
      alreadyActive: true,
      phraseNormalized: v.normalized,
    };
  }

  const inserted = await db
    .insert(learnedPhrases)
    .values({
      phraseNormalized: v.normalized,
      phraseRaw: v.raw,
      addedByTelegramId: input.addedByTelegramId,
    })
    .returning({ id: learnedPhrases.id });
  invalidateCache();
  return {
    ok: true,
    id: inserted[0]!.id,
    alreadyActive: false,
    phraseNormalized: v.normalized,
  };
}

// Remove by raw phrase (user-facing form for /untrain). Normalises and
// soft-deletes the active row, if any. Returns the removed row or null.
export async function removeLearnedPhraseByText(input: {
  rawPhrase: string;
  removedByTelegramId: number;
}): Promise<LearnedPhrase | null> {
  const norm = normalize(input.rawPhrase.trim());
  if (norm.length < MIN_NORMALIZED_LEN) return null;
  const rows = await db
    .update(learnedPhrases)
    .set({
      removedAt: new Date(),
      removedByTelegramId: input.removedByTelegramId,
    })
    .where(
      and(
        eq(learnedPhrases.phraseNormalized, norm),
        isNull(learnedPhrases.removedAt),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  invalidateCache();
  return {
    id: row.id,
    phraseNormalized: row.phraseNormalized,
    phraseRaw: row.phraseRaw,
    addedByTelegramId: row.addedByTelegramId,
    addedAt: row.addedAt,
  };
}

// Remove by id (used by the /learned inline remove button).
export async function removeLearnedPhraseById(input: {
  id: number;
  removedByTelegramId: number;
}): Promise<LearnedPhrase | null> {
  const rows = await db
    .update(learnedPhrases)
    .set({
      removedAt: new Date(),
      removedByTelegramId: input.removedByTelegramId,
    })
    .where(
      and(
        eq(learnedPhrases.id, input.id),
        isNull(learnedPhrases.removedAt),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return null;
  invalidateCache();
  return {
    id: row.id,
    phraseNormalized: row.phraseNormalized,
    phraseRaw: row.phraseRaw,
    addedByTelegramId: row.addedByTelegramId,
    addedAt: row.addedAt,
  };
}

export async function listActiveLearnedPhrases(limit = 50): Promise<LearnedPhrase[]> {
  const rows = await db
    .select()
    .from(learnedPhrases)
    .where(isNull(learnedPhrases.removedAt))
    .orderBy(asc(learnedPhrases.addedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    phraseNormalized: row.phraseNormalized,
    phraseRaw: row.phraseRaw,
    addedByTelegramId: row.addedByTelegramId,
    addedAt: row.addedAt,
  }));
}

// ---- Cache (60s TTL) ----
//
// Moderation calls `getActiveLearnedPhrasesCached` on every message; we
// don't want to hit Postgres each time. 60s is a deliberate ceiling on
// "how long until a /teach takes effect if the cache miss didn't happen
// inline" — but every add/remove also calls invalidateCache(), so admin
// edits propagate immediately within a single bot process.

type CacheEntry = { phrases: ReadonlyArray<string>; loadedAt: number };
const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

export function invalidateCache(): void {
  cache = null;
}

export async function getActiveLearnedPhrasesCached(): Promise<ReadonlyArray<string>> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.phrases;
  }
  const rows = await db
    .select({ phraseNormalized: learnedPhrases.phraseNormalized })
    .from(learnedPhrases)
    .where(isNull(learnedPhrases.removedAt));
  const phrases: string[] = rows.map((r) => r.phraseNormalized);
  cache = { phrases, loadedAt: now };
  return phrases;
}

export async function getLearnedPhraseCount(): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`SELECT COUNT(*)::text AS n FROM learned_phrases WHERE removed_at IS NULL`,
  );
  const rows: ReadonlyArray<{ n: string }> = Array.isArray(result)
    ? result
    : (result as { rows: Array<{ n: string }> }).rows ?? [];
  return Number(rows[0]?.n ?? 0);
}
