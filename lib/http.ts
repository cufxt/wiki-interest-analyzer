/**
 * Small fetch helper with retry/backoff for transient failures.
 *
 * Wikimedia rate-limits requests (429) and occasionally returns 5xx. Those, and
 * network errors, are retried with exponential backoff; every other status is
 * returned to the caller so it can decide (e.g. 404 means "no data" for the
 * Pageviews API, which is not an error).
 */

export interface FetchWithRetryOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  retryStatus?: Set<number>;
  backoffBaseMs?: number;
}

const DEFAULT_RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    headers,
    timeoutMs = 30_000,
    maxAttempts = 3,
    retryStatus = DEFAULT_RETRY_STATUS,
    backoffBaseMs = 500,
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(backoffBaseMs * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }

    if (!retryStatus.has(response.status)) {
      return response;
    }
    if (attempt < maxAttempts) {
      await sleep(backoffBaseMs * 2 ** (attempt - 1));
      continue;
    }
    return response;
  }

  throw new Error(`request did not complete: ${url}`);
}
