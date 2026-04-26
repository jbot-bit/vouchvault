import { pino } from "pino";

export function createLogger(opts: { level?: string } = {}) {
  return pino({
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "*.token",
        "*.secret",
        "*.password",
        "*.api_key",
        "*.authorization",
        "*.privateNote",
        "*.private_note",
        "headers.authorization",
        "params.token",
      ],
      censor: "[REDACTED]",
    },
  });
}
