/**
 * HTTP transport: builds requests, applies the retry policy of
 * `docs/bibliotheques-clientes.md` §3.5 (in the `duva` repository) exactly, and turns a Duva error
 * response into the right {@link DuvaError} subclass.
 */

import {
  DuvaConnectionError,
  DuvaError,
  DuvaTimeoutError,
  errorFromResponse,
} from "./errors.js";

export interface ClientOptions {
  /** Your Duva API key (`dv_...`), created for exactly one domain. Defaults to the
   * `DUVA_API_KEY` environment variable. */
  apiKey?: string;
  /** The domain that API key was created for. Defaults to `DUVA_DOMAIN`. */
  domain?: string;
  /** Defaults to `https://api.duva.ca`. */
  baseUrl?: string;
  /** Total request timeout, in milliseconds. 10000 by default. */
  timeout?: number;
  /** How many times a {@link RequestSpec.safeRetry} request is retried after a network failure or
   * a `5xx`. 2 by default; 0 disables this axis of retrying (an explicit `rate_limited` response
   * is still retried, see `maxRetryWaitSeconds`). */
  maxRetries?: number;
  /** A `429 rate_limited` response is retried only if its `Retry-After` is at most this many
   * seconds; a `quota_exceeded` response is NEVER retried automatically, regardless of this
   * setting (see `docs/bibliotheques-clientes.md` §3.5). 30 by default. */
  maxRetryWaitSeconds?: number;
  /** Sets `Accept-Language`: `"en"` or `"fr"`. Unset by default (Duva's own default is French). */
  language?: "en" | "fr";
  /** Appended to this library's own `User-Agent`, never replacing it. */
  userAgent?: string;
  /** Injectable for tests, or to use a specific `fetch` (proxying, mTLS...). Defaults to the
   * global `fetch`. */
  fetch?: typeof fetch;
}

export interface RequestSpec {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** Whether the WHOLE call may be retried after a network failure or a `5xx` (distinct from the
   * per-error-code `Retry-After` policy, which always applies): false for a write whose outcome,
   * after a timeout, is unknown (see `docs/bibliotheques-clientes.md` §3.5). */
  safeRetry: boolean;
}

const PACKAGE_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://api.duva.ca";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, capped: never a fixed delay, never unbounded. */
function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** attempt, 8000);
  return base / 2 + Math.random() * (base / 2);
}

export class Transport {
  private readonly apiKey: string;
  private readonly domain: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly maxRetryWaitSeconds: number;
  private readonly userAgent: string;
  private readonly language: "en" | "fr" | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClientOptions) {
    const apiKey = options.apiKey ?? envVar("DUVA_API_KEY");
    const domain = options.domain ?? envVar("DUVA_DOMAIN");
    if (!apiKey) {
      throw new TypeError("Duva: an API key is required (options.apiKey or DUVA_API_KEY)");
    }
    if (!domain) {
      throw new TypeError("Duva: a domain is required (options.domain or DUVA_DOMAIN)");
    }
    this.apiKey = apiKey;
    this.domain = domain;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!this.baseUrl.startsWith("https://") && !this.baseUrl.startsWith("http://localhost")) {
      throw new TypeError("Duva: baseUrl must be https:// (http://localhost is allowed for tests)");
    }
    this.timeout = options.timeout ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryWaitSeconds = options.maxRetryWaitSeconds ?? 30;
    this.language = options.language;
    this.userAgent = `duva-node/${PACKAGE_VERSION}${options.userAgent ? ` ${options.userAgent}` : ""}`;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new TypeError("Duva: no global fetch found; pass options.fetch explicitly");
    }
  }

  /** The path prefix for this client's domain (`/v1/<domain>`), for building request paths. */
  get domainPath(): string {
    return `/v1/${encodeURIComponent(this.domain)}`;
  }

  async request<T>(spec: RequestSpec): Promise<{ data: T; headers: Headers }> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.attempt<T>(spec);
      } catch (error) {
        const wait = this.retryDelayMs(spec, error, attempt);
        if (wait === null) throw error;
        attempt += 1;
        await sleep(wait);
      }
    }
  }

  /** `null` = do not retry (rethrow); a number = wait this many milliseconds, then retry. */
  private retryDelayMs(spec: RequestSpec, error: unknown, attempt: number): number | null {
    if (error instanceof DuvaError && "retryAfter" in error) {
      // A `RateLimitError` only: `QuotaExceededError` also has `retryAfter` but is filtered out
      // below by `error.name`, since it must NEVER be retried automatically (§3.5).
      if (error.name !== "RateLimitError") return null;
      const retryAfter = (error as { retryAfter: number }).retryAfter;
      return retryAfter <= this.maxRetryWaitSeconds ? retryAfter * 1000 : null;
    }
    const isTransient =
      error instanceof DuvaConnectionError ||
      error instanceof DuvaTimeoutError ||
      (error instanceof DuvaError && error.name === "ServerError");
    if (!isTransient || !spec.safeRetry || attempt >= this.maxRetries) return null;
    return backoffMs(attempt);
  }

  private async attempt<T>(spec: RequestSpec): Promise<{ data: T; headers: Headers }> {
    const url = new URL(this.baseUrl + spec.path);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({
      authorization: `Bearer ${this.apiKey}`,
      "user-agent": this.userAgent,
    });
    if (this.language) headers.set("accept-language", this.language);
    if (spec.idempotencyKey) headers.set("idempotency-key", spec.idempotencyKey);
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(spec.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: spec.method,
        headers,
        ...(body !== undefined && { body }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new DuvaTimeoutError(`Duva: request timed out after ${this.timeout} ms`);
      }
      throw new DuvaConnectionError("Duva: the request could not be sent", cause);
    } finally {
      clearTimeout(timer);
    }

    const rawBody = await response.text();
    if (response.status === 204) return { data: undefined as T, headers: response.headers };
    if (response.status >= 200 && response.status < 300) {
      return { data: parseJson<T>(rawBody), headers: response.headers };
    }
    throw errorFromResponse(
      response.status,
      safeParseJson(rawBody),
      rawBody,
      response.headers.get("retry-after"),
    );
  }
}

function parseJson<T>(text: string): T {
  return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function envVar(name: string): string | undefined {
  // Only present under Node.js: guarded so this file stays loadable from a bundler targeting a
  // runtime without `process` (the constructor still requires an explicit apiKey/domain there).
  return typeof process !== "undefined" ? process.env[name] : undefined;
}
