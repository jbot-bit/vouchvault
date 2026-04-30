// Inline-cards phase 3: pure forgeries admin renderer + sweep.
//
// /forgeries pagination renderer (pure) + /purge_forgeries sweep
// driver (DI-pure). DB-bound `fetchForgeriesPage` lives in
// `forgeriesStore.ts` so this module stays unit-testable without
// DATABASE_URL (mirror of mirrorPublish ↔ mirrorStore).

import { CARD_GLYPHS, looksLikeCard } from "./forgeryDetector.ts";

const PAGE_SIZE = 10;

export type StrikeRow = {
  id: number;
  userId: number;
  chatId: number;
  messageId: number;
  kind: string;
  detectedAt: Date;
  contentHash: string;
  deleted: boolean;
};

function fmtDate(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

export function renderForgeriesPage(input: {
  rows: StrikeRow[];
  page: number;
  total: number;
}): { text: string; replyMarkup: Record<string, unknown> } {
  const totalPages = Math.max(1, Math.ceil(input.total / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(input.page, totalPages - 1));
  const lines: string[] = [];
  lines.push(`<b>Forgeries</b> — page ${safePage + 1}/${totalPages} (${input.total} total)`);
  if (input.rows.length === 0) {
    lines.push("");
    lines.push("<i>No forgeries recorded.</i>");
  } else {
    lines.push("");
    for (const r of input.rows) {
      const status = r.deleted ? "deleted" : "kept";
      lines.push(
        `${fmtDate(r.detectedAt)} · ${r.kind} · uid=${r.userId} · ${status} · ${r.contentHash}`,
      );
    }
  }
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 0) {
    buttons.push({ text: "‹ prev", callback_data: `vc:p:${safePage - 1}` });
  }
  if (safePage < totalPages - 1) {
    buttons.push({ text: "next ›", callback_data: `vc:p:${safePage + 1}` });
  }
  return {
    text: lines.join("\n"),
    replyMarkup: buttons.length > 0 ? { inline_keyboard: [buttons] } : { inline_keyboard: [] },
  };
}

export type SweepResult = {
  scanned: number;
  candidates: number;
  deleted: number;
  errors: number;
  sample: Array<{ chatId: number; messageId: number; viaBotId: number | null }>;
};

export async function purgeForgeries(input: {
  ourBotId: number | undefined;
  confirm: boolean;
  fetchBatch: (offset: number, limit: number) => Promise<
    Array<{
      groupChatId: number;
      groupMessageId: number;
      viaBotId: number | null;
      text: string | null;
    }>
  >;
  deleteMessage: (chatId: number, messageId: number) => Promise<void>;
}): Promise<SweepResult> {
  const result: SweepResult = {
    scanned: 0,
    candidates: 0,
    deleted: 0,
    errors: 0,
    sample: [],
  };
  let offset = 0;
  const BATCH = 100;
  while (true) {
    const batch = await input.fetchBatch(offset, BATCH);
    if (batch.length === 0) break;
    for (const row of batch) {
      result.scanned += 1;
      if (row.text == null || !looksLikeCard(row.text)) continue;
      if (typeof input.ourBotId === "number" && row.viaBotId === input.ourBotId) continue;
      result.candidates += 1;
      if (result.sample.length < 5) {
        result.sample.push({
          chatId: row.groupChatId,
          messageId: row.groupMessageId,
          viaBotId: row.viaBotId,
        });
      }
      if (input.confirm) {
        try {
          await input.deleteMessage(row.groupChatId, row.groupMessageId);
          result.deleted += 1;
        } catch {
          result.errors += 1;
        }
      }
    }
    offset += batch.length;
    if (batch.length < BATCH) break;
  }
  return result;
}

export { CARD_GLYPHS };
export const FORGERIES_PAGE_SIZE = PAGE_SIZE;
