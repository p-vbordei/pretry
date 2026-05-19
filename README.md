# pretry

[![ci](https://github.com/p-vbordei/pretry/actions/workflows/ci.yml/badge.svg)](https://github.com/p-vbordei/pretry/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/%40p-vbordei%2Fpretry.svg)](https://www.npmjs.com/package/@p-vbordei/pretry)
[![downloads](https://img.shields.io/npm/dm/%40p-vbordei%2Fpretry.svg)](https://www.npmjs.com/package/@p-vbordei/pretry)
[![bundle](https://img.shields.io/bundlejs/size/%40p-vbordei%2Fpretry)](https://bundlejs.com/?q=%40p-vbordei%2Fpretry)

Promise retry with exponential backoff, jitter, `AbortSignal` cancellation, and a custom retriable predicate. Zero dependencies.

```ts
import { retry, isRetriableHttpError } from "@p-vbordei/pretry";

// Retry a fetch up to 3 times on 5xx/429 with full jitter
const res = await retry(async () => {
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

## API

### `retry(fn, opts?): Promise<T>`

`fn` receives the attempt number (0 for first call, 1+ for retries).

| Option | Type | Default | Meaning |
|---|---|---|---|
| `retries` | `number` | `3` | Maximum retries (not counting first attempt) |
| `baseMs` | `number` | `250` | Delay before first retry |
| `maxMs` | `number` | `30000` | Cap on any single delay |
| `factor` | `number` | `2` | Backoff multiplier |
| `jitter` | `"none" \| "full" \| "equal"` | `"full"` | Randomization strategy |
| `retryOn` | `(err, attempt) => boolean` | always true | Return `false` to stop early |
| `onRetry` | `(err, attempt, delayMs) => void` | — | Logging hook |
| `signal` | `AbortSignal` | — | Abort the whole sequence at any point (including during sleep) |
| `random` | `() => number` | `Math.random` | Injectable for tests |

### `isRetriableHttpError(err): boolean`

Helper for use as `retryOn`. Returns `true` for thrown `Response`-like objects with status 408, 425, 429, or 5xx; otherwise `true` for non-status errors (assumed transient).

## Cancellation

Aborting the signal stops the next call immediately and rejects any in-flight sleep with the signal's reason. Pass `AbortSignal.timeout(ms)` for a total deadline.

## License

Apache-2.0 © Vlad Bordei
