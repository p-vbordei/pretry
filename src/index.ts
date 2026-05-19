export interface RetryOptions {
  /** Maximum retry attempts (not counting the first attempt). Default 3. */
  retries?: number;
  /** Base delay in ms for the first retry. Default 250. */
  baseMs?: number;
  /** Maximum delay in ms. Default 30_000. */
  maxMs?: number;
  /** Multiplier per retry. Default 2. */
  factor?: number;
  /** Jitter strategy. Default "full". */
  jitter?: "none" | "full" | "equal";
  /**
   * Decide whether an error should be retried. Default: always true
   * (so any thrown error triggers a retry, up to `retries`).
   */
  retryOn?: (err: unknown, attempt: number) => boolean;
  /** Called before each retry. Useful for logging/metrics. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Abort the whole sequence. Both the in-flight sleep and the next call check this. */
  signal?: AbortSignal;
  /** Injectable randomness for tests. Default Math.random. */
  random?: () => number;
}

function computeDelay(attempt: number, opts: RetryOptions): number {
  const base = opts.baseMs ?? 250;
  const max = opts.maxMs ?? 30_000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? "full";
  const rand = opts.random ?? Math.random;
  const capped = Math.min(base * Math.pow(factor, attempt - 1), max);
  if (jitter === "none") return Math.floor(capped);
  if (jitter === "equal") return Math.floor(capped / 2 + rand() * (capped / 2));
  return Math.floor(rand() * capped);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retry `fn` with exponential backoff. The callback receives the attempt number
 * (0 for the first call, 1+ for retries) so it can vary its behavior if needed.
 *
 * Throws the most recent error if all retries are exhausted, or the `signal`
 * is aborted at any point, or `retryOn` returns false.
 */
export async function retry<T>(
  fn: (attempt: number) => T | Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.retries ?? 3;
  let attempt = 0;
  while (true) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("aborted");
    try {
      return await fn(attempt);
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries) throw err;
      if (opts.retryOn && !opts.retryOn(err, attempt)) throw err;
      const delay = computeDelay(attempt, opts);
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay, opts.signal);
    }
  }
}

/**
 * Default-grade retry predicate for HTTP-flavoured errors.
 *
 * - For thrown `Response`-like objects (with a numeric `status`): retries 5xx,
 *   408 (Request Timeout), 425 (Too Early), 429 (Too Many Requests).
 * - For everything else (network errors, AbortError surrogates, etc.) retries by default.
 *
 * Pass this as `retryOn` in your retry options for sensible HTTP behavior.
 */
export function isRetriableHttpError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    const status = (err as { status: number }).status;
    if (status >= 500 && status < 600) return true;
    return status === 408 || status === 425 || status === 429;
  }
  return true;
}
