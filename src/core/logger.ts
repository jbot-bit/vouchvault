import { pino } from "pino";

// Exported so the redact-test asserts against the same set the runtime
// uses. Adding a path here automatically tightens both.
export const REDACT_PATHS: ReadonlyArray<string> = [
  "*.token",
  "*.secret",
  "*.password",
  "*.api_key",
  "*.authorization",
  "*.privateNote",
  "*.private_note",
  // Invite-link strings are takedown-vector material. A one-shot link
  // logged before admin-approval is still alive and usable until the
  // join is approved or the link expires. Anyone with Railway log
  // access could scrape it. Redact at the logger boundary so no log
  // call site needs to remember to. Cover top-level + one-level-nested
  // paths since pino's wildcard matching doesn't span both implicitly.
  "link",
  "invite_link",
  "inviteLink",
  "invite_url",
  "inviteUrl",
  "*.link",
  "*.invite_link",
  "*.inviteLink",
  "*.invite_url",
  "*.inviteUrl",
  "headers.authorization",
  "params.token",
];

export function createLogger(opts: { level?: string } = {}) {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[REDACTED]",
    },
  });
}
