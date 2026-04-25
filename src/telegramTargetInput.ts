import { normalizeUsername } from "./core/archive.ts";

export function parseTypedTargetUsername(text: string): {
  targetUsername: string | null;
  error: string | null;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { targetUsername: null, error: "Send a target @username." };
  }

  if (/https?:\/\/|t\.me\//i.test(trimmed)) {
    return { targetUsername: null, error: "Send only the @username, not a link." };
  }

  if (/\s/.test(trimmed)) {
    return { targetUsername: null, error: "Send only one @username and nothing else." };
  }

  const atMatches = trimmed.match(/@/g) ?? [];
  if (atMatches.length > 1) {
    return { targetUsername: null, error: "Send only one @username." };
  }

  const targetUsername = normalizeUsername(trimmed);
  if (!targetUsername) {
    return { targetUsername: null, error: "Send a valid Telegram @username." };
  }

  return { targetUsername, error: null };
}
