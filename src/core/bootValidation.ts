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

  // v9 phase 1: VV_MIRROR_ENABLED requires TELEGRAM_CHANNEL_ID to be a
  // Telegram channel id — negative integer with the -100 prefix.
  const mirrorOn = env.VV_MIRROR_ENABLED === "true";
  if (mirrorOn) {
    const raw = env.TELEGRAM_CHANNEL_ID?.trim();
    if (!raw) {
      throw new Error("VV_MIRROR_ENABLED=true requires TELEGRAM_CHANNEL_ID.");
    }
    if (!/^-100\d+$/.test(raw)) {
      throw new Error(
        `TELEGRAM_CHANNEL_ID must be a negative integer with the -100 prefix; got ${JSON.stringify(raw)}.`,
      );
    }
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id >= 0) {
      throw new Error(
        `TELEGRAM_CHANNEL_ID must parse to a negative safe integer; got ${JSON.stringify(raw)}.`,
      );
    }
  }
}

// Returns one human-readable line per opt-in feature gate, capturing
// whether the feature is active and why if disabled. Caller pipes
// these to the boot logger so an operator reading the boot log can
// see the active feature surface at a glance.
export function describeOptInFeatures(env: Env = process.env): string[] {
  const lines: string[] = [];
  if (env.VV_MIRROR_ENABLED === "true") {
    lines.push(
      `backup-channel-mirror: ENABLED (TELEGRAM_CHANNEL_ID=${env.TELEGRAM_CHANNEL_ID?.trim()})`,
    );
  } else {
    lines.push("backup-channel-mirror: disabled (VV_MIRROR_ENABLED unset)");
  }
  return lines;
}
