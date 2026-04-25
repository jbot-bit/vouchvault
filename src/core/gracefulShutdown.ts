type ServerLike = { close(cb: () => void): void };
type PoolLike = { end(): Promise<void> };
type LoggerLike = {
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

export function installGracefulShutdown(opts: {
  server: ServerLike;
  dbPool: PoolLike;
  drainMs: number;
  hardCeilingMs: number;
  logger: LoggerLike;
}) {
  let triggered = false;

  async function runOnce(signal: string) {
    if (triggered) return;
    triggered = true;
    opts.logger.info({ signal }, "graceful shutdown starting");
    const hardTimer = setTimeout(() => {
      opts.logger.error({ signal }, "graceful shutdown exceeded hard ceiling, forcing exit");
      process.exit(1);
    }, opts.hardCeilingMs);
    if (typeof hardTimer.unref === "function") hardTimer.unref();

    await new Promise<void>((resolve) => opts.server.close(() => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, opts.drainMs));
    await opts.dbPool.end();
    clearTimeout(hardTimer);
    opts.logger.info({ signal }, "graceful shutdown complete");
  }

  process.on("SIGTERM", () => {
    void runOnce("SIGTERM").then(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    void runOnce("SIGINT").then(() => process.exit(0));
  });

  return { runOnce };
}
