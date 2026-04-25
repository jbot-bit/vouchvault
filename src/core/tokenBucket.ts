export type TokenBucket = {
  take(): Promise<void>;
};

export function createTokenBucket(intervalMs: number): TokenBucket {
  let nextAvailableAt = 0;
  return {
    async take() {
      const now = Date.now();
      const wait = Math.max(0, nextAvailableAt - now);
      if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
      nextAvailableAt = Math.max(now, nextAvailableAt) + intervalMs;
    },
  };
}
