/**
 * Error hierarchy, mapped from `error.code` (the contract) rather than from the HTTP status or
 * the wording of `error.message`, which can change between languages and over time.
 *
 * See `docs/bibliotheques-clientes.md` §3.6 in the `duva` repository for the source table.
 */

/** Shape Duva always answers with on an error: `{"error": {"code", "message", "fields"?}}`. */
export interface DuvaErrorBody {
  error: {
    code: string;
    message: string;
    fields?: { field: string; message: string }[];
  };
}

/** Base of every error this library raises for a request Duva answered (as opposed to a network
 * failure, see {@link DuvaConnectionError} and {@link DuvaTimeoutError}). */
export class DuvaError extends Error {
  /** The HTTP status Duva answered with. */
  readonly status: number;
  /** `error.code`: the contract. Rely on this, never on `message`. */
  readonly code: string;
  /** `error.fields`, when the error is a validation error (`code === "invalid_request"`). */
  readonly fields: { field: string; message: string }[] | undefined;
  /** The raw response body, bounded to 4 KB: never includes your API key. */
  readonly rawBody: string;

  constructor(status: number, body: DuvaErrorBody, rawBody: string) {
    super(body.error.message);
    this.name = new.target.name;
    this.status = status;
    this.code = body.error.code;
    this.fields = body.error.fields;
    this.rawBody = rawBody.slice(0, 4096);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends DuvaError {}
export class NotFoundError extends DuvaError {}
export class PermissionError extends DuvaError {}
export class ConflictError extends DuvaError {}
export class PayloadTooLargeError extends DuvaError {}

export class ValidationError extends DuvaError {
  override readonly fields: { field: string; message: string }[];
  constructor(status: number, body: DuvaErrorBody, rawBody: string) {
    super(status, body, rawBody);
    this.fields = body.error.fields ?? [];
  }
}

/** A `429` your ACCOUNT quota (daily or monthly). `Retry-After` can be hours: never retried
 * automatically, by design (see `docs/bibliotheques-clientes.md` §3.5). */
export class QuotaExceededError extends DuvaError {
  /** Seconds until the next UTC period, from the `Retry-After` header. */
  readonly retryAfter: number;
  constructor(status: number, body: DuvaErrorBody, rawBody: string, retryAfter: number) {
    super(status, body, rawBody);
    this.retryAfter = retryAfter;
  }
}

/** A `429` from the per-key rate limit (unrelated to your sending quota). Retried automatically
 * when `Retry-After` fits within `maxRetryWaitSeconds`. */
export class RateLimitError extends DuvaError {
  readonly retryAfter: number;
  constructor(status: number, body: DuvaErrorBody, rawBody: string, retryAfter: number) {
    super(status, body, rawBody);
    this.retryAfter = retryAfter;
  }
}

/** A `5xx`, or a response whose body was not the documented error envelope. */
export class ServerError extends DuvaError {}

/** No response was received at all (DNS, TLS, connection refused, connection reset...). */
export class DuvaConnectionError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "DuvaConnectionError";
    this.cause = cause;
  }
}

/** The request exceeded `timeout` (or `connectTimeout`) before any response arrived. */
export class DuvaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuvaTimeoutError";
  }
}

/** A webhook signature failed to verify: never carries the secret or the raw body. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

const CODES: Record<string, new (status: number, body: DuvaErrorBody, rawBody: string) => DuvaError> = {
  unauthorized: AuthenticationError,
  not_found: NotFoundError,
  domain_not_verified: PermissionError,
  sending_not_allowed: PermissionError,
  idempotency_conflict: ConflictError,
  limit_reached: ConflictError,
  payload_too_large: PayloadTooLargeError,
  invalid_request: ValidationError,
  internal_error: ServerError,
  method_not_allowed: ServerError,
  http_error: ServerError,
};

/** Builds the right {@link DuvaError} subclass from a parsed response body, or a generic
 * {@link ServerError} when the body does not match the documented envelope (a proxy error page,
 * for instance); never throws itself. */
export function errorFromResponse(
  status: number,
  parsedBody: unknown,
  rawBody: string,
  retryAfterHeader: string | null,
): DuvaError {
  const body = asErrorBody(parsedBody);
  const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 0;
  if (body.error.code === "quota_exceeded") {
    return new QuotaExceededError(status, body, rawBody, retryAfter);
  }
  if (body.error.code === "rate_limited") {
    return new RateLimitError(status, body, rawBody, retryAfter);
  }
  const Ctor = CODES[body.error.code] ?? ServerError;
  return new Ctor(status, body, rawBody);
}

function asErrorBody(value: unknown): DuvaErrorBody {
  if (
    value !== null &&
    typeof value === "object" &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "object" &&
    (value as { error: { code?: unknown } }).error !== null &&
    typeof (value as { error: { code?: unknown } }).error.code === "string"
  ) {
    return value as DuvaErrorBody;
  }
  return { error: { code: "http_error", message: "Duva answered with an unexpected body." } };
}
