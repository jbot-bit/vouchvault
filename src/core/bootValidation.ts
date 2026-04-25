const BOT_TOKEN_RE = /^\d+:[A-Za-z0-9_-]+$/;
const SECRET_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;

type Env = Record<string, string | undefined>;

function requireEnv(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseIntegerList(env: Env, name: string): number[] {
  const raw = requireEnv(env, name);
  const list = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => Number(p));
  if (list.length === 0 || list.some((n) => !Number.isSafeInteger(n))) {
    throw new Error(
      `${name} must be a comma-separated list of integers; got ${JSON.stringify(raw)}.`,
    );
  }
  return list;
}

export function validateBootEnv(env: Env = process.env): void {
  requireEnv(env, "DATABASE_URL");
  const token = requireEnv(env, "TELEGRAM_BOT_TOKEN");
  if (!BOT_TOKEN_RE.test(token)) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN does not match the expected token shape '<digits>:<alnum_-+>'.",
    );
  }
  parseIntegerList(env, "TELEGRAM_ALLOWED_CHAT_IDS");
  parseIntegerList(env, "TELEGRAM_ADMIN_IDS");

  const isProd = env.NODE_ENV === "production";
  const secret = env.TELEGRAM_WEBHOOK_SECRET_TOKEN?.trim();
  if (isProd) {
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN is required in production.");
    if (!SECRET_TOKEN_RE.test(secret))
      throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN must be 1-256 chars [A-Za-z0-9_-].");
  } else if (secret && !SECRET_TOKEN_RE.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET_TOKEN must be 1-256 chars [A-Za-z0-9_-].");
  }
}
