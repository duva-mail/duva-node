import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  ConflictError,
  DuvaError,
  NotFoundError,
  PermissionError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ValidationError,
  errorFromResponse,
} from "../../src/errors.js";

describe("errorFromResponse", () => {
  it("maps each documented code to its class", () => {
    const cases: [string, number, new (...args: never[]) => DuvaError][] = [
      ["unauthorized", 401, AuthenticationError],
      ["not_found", 404, NotFoundError],
      ["domain_not_verified", 403, PermissionError],
      ["sending_not_allowed", 403, PermissionError],
      ["idempotency_conflict", 409, ConflictError],
      ["limit_reached", 409, ConflictError],
      ["invalid_request", 422, ValidationError],
      ["internal_error", 500, ServerError],
    ];
    for (const [code, status, Ctor] of cases) {
      const error = errorFromResponse(status, { error: { code, message: "x" } }, "{}", null);
      expect(error).toBeInstanceOf(Ctor);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
    }
  });

  it("carries retryAfter for quota_exceeded and rate_limited, and only those", () => {
    const quota = errorFromResponse(
      429,
      { error: { code: "quota_exceeded", message: "x" } },
      "{}",
      "3600",
    );
    expect(quota).toBeInstanceOf(QuotaExceededError);
    expect((quota as QuotaExceededError).retryAfter).toBe(3600);

    const rate = errorFromResponse(
      429,
      { error: { code: "rate_limited", message: "x" } },
      "{}",
      "5",
    );
    expect(rate).toBeInstanceOf(RateLimitError);
    expect((rate as RateLimitError).retryAfter).toBe(5);
  });

  it("carries field errors on invalid_request", () => {
    const error = errorFromResponse(
      422,
      { error: { code: "invalid_request", message: "x", fields: [{ field: "to[0]", message: "bad" }] } },
      "{}",
      null,
    ) as ValidationError;
    expect(error.fields).toEqual([{ field: "to[0]", message: "bad" }]);
  });

  it("never crashes on a body that is not the documented envelope", () => {
    const error = errorFromResponse(502, "<html>bad gateway</html>", "<html>bad gateway</html>", null);
    expect(error).toBeInstanceOf(ServerError);
    expect(error.code).toBe("http_error");
  });

  it("bounds the raw body it keeps, and never includes more than what was given", () => {
    const huge = "x".repeat(10_000);
    const error = errorFromResponse(500, undefined, huge, null);
    expect(error.rawBody.length).toBeLessThanOrEqual(4096);
  });

  it("an unknown code falls back to ServerError rather than crashing", () => {
    const error = errorFromResponse(599, { error: { code: "something_new", message: "x" } }, "{}", null);
    expect(error).toBeInstanceOf(ServerError);
    expect(error.code).toBe("something_new");
  });
});
