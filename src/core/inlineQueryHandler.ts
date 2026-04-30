// Inline-cards phase 2: pure inline_query handler.
//
// Steps:
//   1. Reject if from.id is not in the SC45 member registry — return
//      a single non-insertable hint that points to DM /lookup.
//   2. Reject chat_type ∉ {sender, supergroup} (residual API gap:
//      we cannot tell which supergroup, only that it IS one).
//   3. Empty / whitespace query → "Type a username, e.g. @daveyboi".
//   4. Apply per-user inline rate limit (5s).
//   5. Look up archive rows for the requested @username.
//   6. Render the card via inlineCard.renderInlineCard.
//   7. answerInlineQuery with cache_time:0, is_personal:true.
//
// Deadlines: Telegram drops answerInlineQuery after ~10s. Soft 7s
// budget enforced via Promise.race; on miss we emit empty results
// so the caller doesn't blow the cliff.
//
// See docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md §6.5,
// docs/superpowers/plans/2026-05-01-inline-vouch-cards.md (Phase 2).

import { renderInlineCard, type ArchiveRowForCard } from "./inlineCard.ts";

const SOFT_DEADLINE_MS = 7_000;

export type InlineQueryDeps = {
  isMember: (userId: number) => Promise<boolean>;
  fetchArchive: (
    targetUsername: string,
  ) => Promise<{ targetId: number; rows: Array<ArchiveRowForCard> } | null>;
  rateLimit: (
    userId: number,
    now?: number,
  ) => { allowed: true } | { allowed: false; retryAfterMs: number };
  answer: (input: {
    inlineQueryId: string;
    results: Array<Record<string, unknown>>;
    cacheTime?: number;
    isPersonal?: boolean;
    button?: { text: string; start_parameter?: string };
  }) => Promise<void>;
  recordChoice?: (input: {
    userId: number;
    targetUsername: string;
    contentHash: string;
  }) => Promise<void>;
  logger?: { info?: (ctx: any, msg: string) => void; warn?: (ctx: any, msg: string) => void };
  now?: () => Date;
};

export type InlineQueryUpdate = {
  id?: string;
  from?: { id?: number };
  query?: string;
  chat_type?: string;
};

function hint(opts: {
  id: string;
  title: string;
  message: string;
}): Record<string, unknown> {
  return {
    type: "article",
    id: opts.id,
    title: opts.title,
    description: opts.message,
    input_message_content: {
      message_text: opts.message,
      parse_mode: "HTML",
    },
  };
}

function nonInsertableHint(opts: {
  id: string;
  title: string;
  message: string;
}): Record<string, unknown> {
  // Inline mode requires input_message_content. Make it text the user
  // wouldn't typically want to send — title is what they see in the
  // popup; if they tap, this is what gets posted. Keep it polite.
  return hint(opts);
}

function nonMemberPmButton() {
  return { text: "DM the bot to /lookup", start_parameter: "lookup" };
}

export type InlineHandleResult =
  | { kind: "non_member" }
  | { kind: "wrong_chat_type" }
  | { kind: "empty_query" }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "no_record"; targetUsername: string }
  | { kind: "card"; targetUsername: string; contentHash: string }
  | { kind: "deadline_exceeded" }
  | { kind: "ignored"; reason: string };

export async function handleInlineQuery(
  deps: InlineQueryDeps,
  update: InlineQueryUpdate,
): Promise<InlineHandleResult> {
  const inlineQueryId = update.id;
  const userId = update.from?.id;
  const chatType = update.chat_type;
  if (typeof inlineQueryId !== "string" || typeof userId !== "number") {
    return { kind: "ignored", reason: "missing id/from" };
  }

  // (2) chat_type filter. `sender` = bot's own DM with the user.
  if (chatType !== undefined && chatType !== "sender" && chatType !== "supergroup") {
    await safeAnswer(deps, inlineQueryId, [
      nonInsertableHint({
        id: "wrong_chat",
        title: "Inline lookups are SC45-only",
        message: "DM @VouchVaultBot to use /lookup.",
      }),
    ]);
    return { kind: "wrong_chat_type" };
  }

  // (1) Member gate.
  const isMember = await deps.isMember(userId);
  if (!isMember) {
    await safeAnswer(
      deps,
      inlineQueryId,
      [
        nonInsertableHint({
          id: "non_member",
          title: "Inline lookups are SC45-only",
          message: "DM @VouchVaultBot to use /lookup.",
        }),
      ],
      nonMemberPmButton(),
    );
    return { kind: "non_member" };
  }

  // (3) Empty query.
  const raw = (update.query ?? "").trim();
  if (raw.length === 0) {
    await safeAnswer(deps, inlineQueryId, [
      nonInsertableHint({
        id: "empty",
        title: "Type a username",
        message: "Try @VouchVaultBot @daveyboi",
      }),
    ]);
    return { kind: "empty_query" };
  }
  const targetUsername = raw.replace(/^@+/, "").toLowerCase();

  // (4) Rate-limit.
  const rl = deps.rateLimit(userId);
  if (!rl.allowed) {
    const retrySec = Math.max(1, Math.round(rl.retryAfterMs / 1000));
    await safeAnswer(deps, inlineQueryId, [
      nonInsertableHint({
        id: "rate_limited",
        title: "Slow down a sec",
        message: `Try again in ${retrySec}s.`,
      }),
    ]);
    return { kind: "rate_limited", retryAfterMs: rl.retryAfterMs };
  }

  // (5)+(6)+(7) Archive lookup → render → answer, with soft deadline.
  const work = (async () => {
    const fetched = await deps.fetchArchive(targetUsername);
    if (!fetched || fetched.rows.length === 0) {
      await safeAnswer(deps, inlineQueryId, [
        nonInsertableHint({
          id: `nr_${targetUsername}`,
          title: `No record for @${targetUsername}`,
          message: `No legacy archive entries for @${targetUsername}.`,
        }),
      ]);
      return { kind: "no_record" as const, targetUsername };
    }
    const card = renderInlineCard({
      targetUsername,
      targetId: fetched.targetId,
      archiveRows: fetched.rows,
      now: (deps.now ?? (() => new Date()))(),
    });
    if (!card) {
      await safeAnswer(deps, inlineQueryId, [
        nonInsertableHint({
          id: `nr_${targetUsername}`,
          title: `No record for @${targetUsername}`,
          message: `No legacy archive entries for @${targetUsername}.`,
        }),
      ]);
      return { kind: "no_record" as const, targetUsername };
    }
    const result: Record<string, unknown> = {
      type: "article",
      id: `${fetched.targetId}:${card.contentHash}`,
      title: `Vouch card for @${targetUsername}`,
      description: card.text.split("\n")[0] ?? "",
      input_message_content: {
        message_text: card.text,
      },
    };
    await safeAnswer(deps, inlineQueryId, [result]);
    return { kind: "card" as const, targetUsername, contentHash: card.contentHash };
  })();

  const deadline = new Promise<InlineHandleResult>((resolve) => {
    setTimeout(() => resolve({ kind: "deadline_exceeded" }), SOFT_DEADLINE_MS);
  });

  return Promise.race([work, deadline]).catch((error) => {
    deps.logger?.warn?.({ error, userId, targetUsername }, "[inline] handler threw");
    return { kind: "ignored", reason: "error" } as InlineHandleResult;
  });
}

async function safeAnswer(
  deps: InlineQueryDeps,
  inlineQueryId: string,
  results: Array<Record<string, unknown>>,
  button?: { text: string; start_parameter?: string },
): Promise<void> {
  try {
    await deps.answer({ inlineQueryId, results, cacheTime: 0, isPersonal: true, button });
  } catch (error) {
    deps.logger?.warn?.({ error, inlineQueryId }, "[inline] answer failed (non-fatal)");
  }
}

// Subscribed-update handler for chosen_inline_result. Persists the
// content_hash by parsing the result_id we baked in handleInlineQuery
// (`<targetId>:<contentHash>`).
export async function handleChosenInlineResult(
  deps: Pick<InlineQueryDeps, "recordChoice" | "logger">,
  update: { result_id?: string; from?: { id?: number }; query?: string },
): Promise<void> {
  const userId = update.from?.id;
  const resultId = update.result_id ?? "";
  const sep = resultId.indexOf(":");
  const contentHash = sep >= 0 ? resultId.slice(sep + 1) : "";
  const rawQuery = (update.query ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (typeof userId !== "number" || rawQuery.length === 0 || contentHash.length === 0) {
    return;
  }
  try {
    await deps.recordChoice?.({ userId, targetUsername: rawQuery, contentHash });
  } catch (error) {
    deps.logger?.warn?.({ error, userId }, "[inline] chosen_inline_result record failed");
  }
}
