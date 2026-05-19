# pretry

[![ci](https://github.com/p-vbordei/pretry/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/pretry/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/%40p-vbordei%2Fpretry.svg)](https://www.npmjs.com/package/@p-vbordei/pretry)
[![downloads](https://img.shields.io/npm/dm/%40p-vbordei%2Fpretry.svg)](https://www.npmjs.com/package/@p-vbordei/pretry)
[![bundle](https://img.shields.io/bundlejs/size/%40p-vbordei%2Fpretry)](https://bundlejs.com/?q=%40p-vbordei%2Fpretry)

> Promise retry with exponential backoff, jitter, `AbortSignal` cancellation, and a custom retriable predicate. Zero dependencies.

```ts
import { retry, isRetriableHttpError } from "@p-vbordei/pretry";

const data = await retry(async () => {
  const r = await fetch(url);
  if (!r.ok) throw r;       // throw the Response so the predicate can inspect status
  return r.json();
}, {
  retries: 3,
  retryOn: isRetriableHttpError,
  onRetry: (err, attempt, ms) => console.warn(`retry #${attempt} in ${ms}ms`),
  signal: AbortSignal.timeout(10_000),
});
```

## Install

```sh
npm install @p-vbordei/pretry
```

Works with Node 20+, browsers, Bun, Deno. ESM + CJS.

## Why

You need retries with backoff and jitter. Most existing options either:

- Ship without `AbortSignal` integration (so an "aborted" client still sleeps through retries)
- Have opinionated default behavior that retries on every error (including 4xx user errors)
- Pull in 50KB for what should be a 100-line implementation

`pretry` is the minimal correct version: AbortSignal-first, predicate-driven, jitter by default to avoid thundering-herd reconnects.

## Recipes

### Fetch with retry on 5xx + 429

```ts
import { retry, isRetriableHttpError } from "@p-vbordei/pretry";

const json = await retry(
  async () => {
    const r = await fetch(url);
    if (!r.ok) throw r;
    return r.json();
  },
  { retries: 3, retryOn: isRetriableHttpError },
);
```

### Total deadline + per-call timeout

```ts
import { retry } from "@p-vbordei/pretry";

const total = AbortSignal.timeout(30_000);  // give up after 30s of trying

await retry(
  async () => {
    const perCall = AbortSignal.timeout(5_000);  // 5s per attempt
    const r = await fetch(url, { signal: perCall });
    if (!r.ok) throw r;
    return r;
  },
  { retries: 10, signal: total },
);
```

### Retry on transient network errors only

```ts
import { retry } from "@p-vbordei/pretry";

await retry(
  () => connectDatabase(),
  {
    retryOn: (err) => err instanceof Error && /ECONN|ETIMEDOUT|EAI_AGAIN/.test(err.message),
    retries: 5,
    baseMs: 500,
    maxMs: 10_000,
  },
);
```

### Idempotency-aware POST retry

```ts
import { retry, isRetriableHttpError } from "@p-vbordei/pretry";

const idempotencyKey = crypto.randomUUID();

await retry(
  async () => {
    const r = await fetch(url, {
      method: "POST",
      body,
      headers: { "Idempotency-Key": idempotencyKey },
    });
    if (!r.ok) throw r;
    return r;
  },
  { retries: 3, retryOn: isRetriableHttpError },
);
```

### Inspect attempt count from inside `fn`

```ts
import { retry } from "@p-vbordei/pretry";

await retry(
  async (attempt) => {
    if (attempt > 0) console.log(`retry #${attempt}`);
    return await doWork();
  },
);
```

## API

### `retry(fn, opts?): Promise<T>`

`fn` receives the attempt number (`0` for the first call, `1+` for retries).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `retries` | `number` | `3` | Maximum retries (not counting first attempt) |
| `baseMs` | `number` | `250` | Delay before first retry |
| `maxMs` | `number` | `30_000` | Cap on any single delay |
| `factor` | `number` | `2` | Backoff multiplier |
| `jitter` | `"none" \| "full" \| "equal"` | `"full"` | Randomization strategy |
| `retryOn` | `(err, attempt) => boolean` | always true | Return `false` to stop early |
| `onRetry` | `(err, attempt, delayMs) => void` | — | Logging hook |
| `signal` | `AbortSignal` | — | Abort the whole sequence at any point (including during sleep) |
| `random` | `() => number` | `Math.random` | Injectable for tests |

### `isRetriableHttpError(err): boolean`

Helper for use as `retryOn`. Returns `true` for thrown `Response`-like objects with status 408, 425, 429, or 5xx; otherwise `true` for non-status errors (assumed transient — network/timeout).

## Jitter strategies

| Mode | Formula | Use when |
|---|---|---|
| `none` | `min(base * factor^(n-1), max)` | Deterministic / for tests |
| `full` (default) | `random() * cappedExponential` | Best general default — avoids thundering herd |
| `equal` | `half + random() * half` | Less variance but still some randomization |

## Caveats

- **Underlying work isn't canceled** by the signal — only `pretry`'s view of it. For real cancellation, the underlying API must accept `AbortSignal` itself (e.g. `fetch(url, { signal })`).
- **No circuit breaker built in** — combine with [@p-vbordei/circuit-breaker](https://github.com/p-vbordei/circuit-breaker) if you need to short-circuit after sustained failures.
- **No rate limiting** — combine with [@p-vbordei/token-bucket](https://github.com/p-vbordei/token-bucket).

## License

Apache-2.0 © Vlad Bordei
