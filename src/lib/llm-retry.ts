const RETRY_DELAYS_MS = [500, 1500, 4000] as const;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 524, 529]);
const NON_RETRYABLE_STATUS = new Set([400, 401, 402, 403, 404, 422]);

export interface RetryError {
  status?: number;
  retryAfterMs?: number;
  message: string;
}

export interface RetryAttempt {
  index: number;
  fallback: boolean;
}

export interface RetryOpts {
  maxAttempts?: number;
  onAttempt?: (attempt: RetryAttempt) => void;
}

export class NonRetryableError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NonRetryableError";
  }
}

function jitter(ms: number): number {
  return Math.round(ms * (0.7 + Math.random() * 0.6));
}

function extractStatus(err: unknown): { status?: number; retryAfterMs?: number } {
  if (typeof err !== "object" || err === null) return {};
  const anyErr = err as { statusCode?: unknown; status?: unknown; responseHeaders?: Record<string, string> };
  const status =
    typeof anyErr.statusCode === "number"
      ? anyErr.statusCode
      : typeof anyErr.status === "number"
        ? anyErr.status
        : undefined;
  const headers = anyErr.responseHeaders ?? {};
  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (!Number.isNaN(sec)) retryAfterMs = sec * 1000;
  }
  return { status, retryAfterMs };
}

export async function withRetry<T>(fn: (attempt: RetryAttempt) => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastErr: unknown = null;
  let useFallback = false;

  for (let i = 0; i < maxAttempts; i++) {
    const attempt: RetryAttempt = { index: i, fallback: useFallback };
    opts.onAttempt?.(attempt);
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const { status, retryAfterMs } = extractStatus(err);

      if (status !== undefined && NON_RETRYABLE_STATUS.has(status)) {
        throw new NonRetryableError(status, err instanceof Error ? err.message : String(err));
      }
      if (status !== undefined && !RETRYABLE_STATUS.has(status)) {
        throw err;
      }
      if (i === maxAttempts - 1) break;

      useFallback = status === 529;
      const baseDelay = RETRY_DELAYS_MS[i] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      const delay = retryAfterMs ?? jitter(baseDelay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
