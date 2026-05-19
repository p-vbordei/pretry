import { describe, it, expect, vi } from "vitest";
import { retry, isRetriableHttpError } from "../src/index.js";

const noJitter = { jitter: "none" as const, baseMs: 1, maxMs: 100 };

describe("retry: happy path", () => {
  it("returns value when fn succeeds", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    expect(await retry(fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    };
    expect(await retry(fn, noJitter)).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws final error after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("perma"));
    await expect(retry(fn, { retries: 2, ...noJitter })).rejects.toThrow("perma");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("passes attempt number to callback", async () => {
    const seen: number[] = [];
    const fn = async (attempt: number) => {
      seen.push(attempt);
      if (attempt < 2) throw new Error("not yet");
      return attempt;
    };
    expect(await retry(fn, noJitter)).toBe(2);
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe("retryOn", () => {
  it("stops retrying when predicate returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      retry(fn, { retries: 5, retryOn: () => false, ...noJitter }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("receives attempt number", async () => {
    const calls: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    await expect(
      retry(fn, {
        retries: 3,
        retryOn: (_e, a) => {
          calls.push(a);
          return a < 2;
        },
        ...noJitter,
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([1, 2]);
  });
});

describe("onRetry", () => {
  it("called before each retry with err and delay", async () => {
    const log: Array<{ err: unknown; attempt: number; delay: number }> = [];
    const fn = vi.fn().mockRejectedValue(new Error("retry me"));
    await expect(
      retry(fn, {
        retries: 2,
        onRetry: (err, attempt, delay) => log.push({ err, attempt, delay }),
        ...noJitter,
      }),
    ).rejects.toThrow();
    expect(log).toHaveLength(2);
    expect(log[0]!.attempt).toBe(1);
    expect(log[1]!.attempt).toBe(2);
  });
});

describe("AbortSignal", () => {
  it("rejects immediately if already aborted", async () => {
    const ac = new AbortController();
    ac.abort(new Error("nope"));
    await expect(retry(() => 1, { signal: ac.signal })).rejects.toThrow("nope");
  });

  it("aborts during sleep", async () => {
    const ac = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    setTimeout(() => ac.abort(new Error("stop")), 20);
    await expect(
      retry(fn, { retries: 10, baseMs: 100, maxMs: 100, jitter: "none", signal: ac.signal }),
    ).rejects.toThrow("stop");
  });
});

describe("isRetriableHttpError", () => {
  it.each([500, 503, 502, 599, 408, 425, 429])("retries status %i", (s) => {
    expect(isRetriableHttpError({ status: s })).toBe(true);
  });
  it.each([400, 401, 403, 404, 422])("does not retry status %i", (s) => {
    expect(isRetriableHttpError({ status: s })).toBe(false);
  });
  it("retries generic errors", () => {
    expect(isRetriableHttpError(new Error("network"))).toBe(true);
  });
});

describe("jitter modes", () => {
  it("none mode uses deterministic delay", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    await expect(
      retry(fn, {
        retries: 3,
        baseMs: 10,
        factor: 2,
        jitter: "none",
        onRetry: (_e, _a, d) => delays.push(d),
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([10, 20, 40]);
  });

  it("full mode uses random source", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error("x"));
    await expect(
      retry(fn, {
        retries: 2,
        baseMs: 100,
        factor: 2,
        jitter: "full",
        random: () => 0.5,
        onRetry: (_e, _a, d) => delays.push(d),
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([50, 100]);
  });
});
