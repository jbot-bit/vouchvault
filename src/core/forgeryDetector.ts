// Inline-cards phase 1: pure forgery detector.
//
// Defends against V3-shape templated impersonation. Catches two attacks:
//
//   1. forge_from_blank — a hand-typed message that LOOKS like a vouch
//      card but never went through the bot. Telegram doesn't stamp
//      `via_bot` on it, so the field is absent.
//   2. edit_of_real_card — a member runs inline mode to insert a real
//      card (which Telegram stamps with via_bot.id = OUR_BOT_ID), then
//      edits the body to lie. v1 deletes on any edit — content-hash
//      compare is deferred to v2.
//
// Plus lookalike_bot defence: `via @VouchVau1tBot` (lookalike L→1) has a
// different numeric bot id, so `via_bot.id !== OUR_BOT_ID` short-circuits.
//
// Pure. No DB, no I/O. Imports only Node built-ins so it can be loaded
// in any context. Glyph constants are the SINGLE SOURCE OF TRUTH for
// the card shape — `inlineCard.ts` (phase 2) imports them so the
// renderer and detector cannot drift.
//
// See docs/superpowers/specs/2026-05-01-inline-vouch-cards-design.md
// and docs/superpowers/plans/2026-05-01-inline-vouch-cards.md (Phase 1).

import { createHash } from "node:crypto";

// Single source of truth for the card shape. Imported by the renderer.
// Strict — em-dash and middot are intentionally hard to type by accident.
export const CARD_GLYPHS = {
  board: "📋",
  emDash: "—", // U+2014
  middot: "·", // U+00B7
  pos: "✅",
  warn: "⚠️",
} as const;

// Header line: `📋 @username — N ✅ · M ⚠️ (extra)`.
// Match is anchored to start-of-message so prose mentions of the bot
// (e.g. "via @VouchVaultBot is sick") cannot match. We look for the
// header followed by at least one bullet line — that combination is
// the structural fingerprint of a real card.
const HEADER_RE = /^📋 @[A-Za-z0-9_]{3,}\s+—\s+\d+\s+✅\s+·\s+\d+\s+⚠️/u;
const BULLET_RE = /\n·\s+\d{2}\/\d{2}\/\d{4}\s+@[A-Za-z0-9_]+\s+—\s+/u;

export const CARD_REGEX = /CARD/; // exported handle for tests; real check uses looksLikeCard()

// Zero-width characters that forgers might use to slip past a naive
// regex. We strip these before evaluating shape.
const ZERO_WIDTH = /[​‌‍⁠﻿]/g;

export function stripZeroWidth(input: string): string {
  return input.replace(ZERO_WIDTH, "");
}

export function looksLikeCard(rawText: string | null | undefined): boolean {
  if (typeof rawText !== "string") return false;
  // Performance early-out: no board glyph → not a card.
  if (!rawText.includes(CARD_GLYPHS.board)) return false;
  const body = stripZeroWidth(rawText);
  if (!HEADER_RE.test(body)) return false;
  if (!BULLET_RE.test(body)) return false;
  return true;
}

export function hashCardBody(body: string): string {
  const normalised = stripZeroWidth(body).trim();
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

export type ForgeryKind = "forge_from_blank" | "edit_of_real_card" | "lookalike_bot";

export type ForgeryVerdict = {
  kind: ForgeryKind;
  reason: string;
  contentHash: string;
};

type DetectInput = {
  message: any;
  ourBotId: number | undefined;
  kind: "message" | "edited_message";
};

// Returns a verdict if the message is a forgery, otherwise null.
//
// Defense order:
//   1. Bot-authored messages (`from.is_bot` or `from.id === OUR_BOT_ID`)
//      → null. We never moderate other bots or ourselves.
//   2. Message has no card-shape body → null (cheap early-out).
//   3. ourBotId is unknown → null (fail open during boot getMe gap).
//   4. via_bot.id matches ours →
//        - kind 'message': not a forgery (real card insertion).
//        - kind 'edited_message': forgery — edit_of_real_card.
//   5. via_bot is missing or != ours →
//        - other bot's card-shape relay: lookalike_bot.
//        - no via_bot at all: forge_from_blank.
export function detectForgery(input: DetectInput): ForgeryVerdict | null {
  const { message, ourBotId, kind } = input;
  if (!message) return null;

  // (1) Skip bot-authored messages entirely (defence in depth on top of
  // via_bot — handles GroupHelp, our own bot's outputs, any third-party).
  const from = message.from;
  if (from?.is_bot === true) return null;
  if (typeof ourBotId === "number" && from?.id === ourBotId) return null;

  const text = typeof message.text === "string" ? message.text : message.caption;
  if (typeof text !== "string") return null;

  // (2) Cheap early-out before regex.
  if (!text.includes(CARD_GLYPHS.board)) return null;
  if (!looksLikeCard(text)) return null;

  // (3) Fail open if we don't know our own id yet — better to miss a
  // forgery than delete a real card during boot.
  if (typeof ourBotId !== "number") return null;

  const viaBotId = message.via_bot?.id;
  const isOurs = typeof viaBotId === "number" && viaBotId === ourBotId;

  const contentHash = hashCardBody(text);

  if (isOurs) {
    if (kind === "edited_message") {
      return {
        kind: "edit_of_real_card",
        reason: "via_bot=ours but message was edited",
        contentHash,
      };
    }
    return null; // real, untouched card
  }

  if (typeof viaBotId === "number") {
    return {
      kind: "lookalike_bot",
      reason: `via_bot.id ${viaBotId} != ${ourBotId}`,
      contentHash,
    };
  }

  return {
    kind: "forge_from_blank",
    reason: "card-shape body with no via_bot",
    contentHash,
  };
}
