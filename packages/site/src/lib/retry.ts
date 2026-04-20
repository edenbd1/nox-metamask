const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withIngestionRetry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    initialDelayMs?: number;
    onAttempt?: (info: { attempt: number; delayMs: number }) => void;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 8;
  const initial = opts.initialDelayMs ?? 3000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error).message ?? '';
      const isLag = msg.includes('Object not found') || msg.includes('404');
      if (!isLag) throw err;
      const delay = initial * (i + 1);
      opts.onAttempt?.({ attempt: i + 1, delayMs: delay });
      await sleep(delay);
    }
  }
  throw lastErr;
}
