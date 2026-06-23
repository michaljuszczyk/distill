import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NonRetryableError, streamWithRetry, withRetry, type RetryAttempt } from "./llm-retry";

// Build an Error carrying an HTTP-ish shape the way the AI SDK surfaces it.
function httpErr(status: number, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
}

describe("withRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the result without retrying on first success", async () => {
    const fn = vi.fn((): Promise<string> => Promise.resolve("ok"));
    const p = withRetry(fn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable status (503) then succeeds", async () => {
    let calls = 0;
    const fn = vi.fn((): Promise<string> => {
      calls++;
      return calls === 1 ? Promise.reject(httpErr(503)) : Promise.resolve("ok");
    });
    const p = withRetry(fn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("reads the status from `statusCode` as well as `status`", async () => {
    let calls = 0;
    const fn = vi.fn((): Promise<string> => {
      calls++;
      return calls === 1
        ? Promise.reject(Object.assign(new Error("rate limited"), { statusCode: 429 }))
        : Promise.resolve("ok");
    });
    const p = withRetry(fn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable status (401) and wraps it as NonRetryableError", async () => {
    const fn = vi.fn((): Promise<string> => Promise.reject(httpErr(401)));
    const p = withRetry(fn);
    // Subscribe before advancing timers so the rejection is never unhandled.
    const assertion = expect(p).rejects.toBeInstanceOf(NonRetryableError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows an unknown status (418) without retrying", async () => {
    const err = httpErr(418);
    const fn = vi.fn((): Promise<string> => Promise.reject(err));
    const p = withRetry(fn);
    const assertion = expect(p).rejects.toBe(err);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes a NonRetryableError straight through", async () => {
    const err = new NonRetryableError(403, "forbidden");
    const fn = vi.fn((): Promise<string> => Promise.reject(err));
    const p = withRetry(fn);
    const assertion = expect(p).rejects.toBe(err);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts maxAttempts on persistent retryable errors and throws the last error", async () => {
    const err = httpErr(500);
    const fn = vi.fn((): Promise<string> => Promise.reject(err));
    const p = withRetry(fn, { maxAttempts: 3 });
    const assertion = expect(p).rejects.toBe(err);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("flags fallback on the attempt after a 529 (overloaded)", async () => {
    const attempts: RetryAttempt[] = [];
    let calls = 0;
    const fn = vi.fn((): Promise<string> => {
      calls++;
      return calls === 1 ? Promise.reject(httpErr(529)) : Promise.resolve("ok");
    });
    const p = withRetry(fn, { onAttempt: (a) => attempts.push({ ...a }) });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(attempts).toHaveLength(2);
    expect(attempts[0].fallback).toBe(false);
    expect(attempts[1].fallback).toBe(true);
  });

  it("honors a retry-after header instead of the default backoff", async () => {
    let calls = 0;
    const fn = vi.fn((): Promise<string> => {
      calls++;
      return calls === 1
        ? Promise.reject(httpErr(429, { responseHeaders: { "retry-after": "2" } }))
        : Promise.resolve("ok");
    });
    const p = withRetry(fn);
    // retry-after: 2s — must not retry before then.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("streamWithRetry", () => {
  function stringStream(chunks: string[]): ReadableStream<string> {
    return new ReadableStream<string>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
  }

  it("assembles streamed chunks into a text/plain Response", async () => {
    const res = await streamWithRetry(() => ({ textStream: stringStream(["a", "b", "c"]) }));
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("content-type")).toContain("text/plain");
    await expect(res.text()).resolves.toBe("abc");
  });

  it("handles an empty stream", async () => {
    const res = await streamWithRetry(() => ({ textStream: stringStream([]) }));
    await expect(res.text()).resolves.toBe("");
  });
});
