/**
 * Webhook signature verification, "Standard Webhooks" format (see `docs/api.md` "Webhooks" in the
 * `duva` repository). Duva SENDS webhooks; this module is for VERIFYING them on your side.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";

/** The JSON body Duva sends to your webhook URL, already parsed. */
export interface WebhookEvent {
  id: string;
  type:
    | "delivered"
    | "bounced"
    | "deferred"
    | "expired"
    | "complained"
    | "opened"
    | "clicked";
  domain: string;
  data: {
    message_id: string;
    recipient: string;
    occurred_at: string;
    detail: Record<string, unknown>;
    metadata: Record<string, string>;
  };
}

export interface VerifyOptions {
  /** Seconds a signature stays valid after `webhook-timestamp` (replay protection). 300 by
   * default, matching Duva's own tolerance; do not raise it. */
  toleranceSeconds?: number;
  /** The current instant, as a Unix timestamp in seconds. Defaults to `Date.now() / 1000`;
   * override only in your OWN tests (see {@link signWebhookRequest} and the fixtures of
   * `duva-mail/duva-conformance`, which document the exact instant each vector was signed at). */
  now?: number;
}

/** Case-insensitive lookup: the headers a web framework hands you may be a `Headers` object, a
 * plain object, or an array of `[name, value]` pairs; keys are never guaranteed lower-case. */
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined> | [string, string][];

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name);
    return found?.[1];
  }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) {
      const value = headers[key];
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function decodeSecret(secret: string): Buffer {
  const prefix = "whsec_";
  if (!secret.startsWith(prefix)) {
    throw new WebhookSignatureError("a Duva webhook secret starts with whsec_");
  }
  return Buffer.from(secret.slice(prefix.length), "base64");
}

function expectedSignature(secret: string, id: string, timestamp: string, rawBody: string | Uint8Array): string {
  const signed = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
  ]);
  return createHmac("sha256", decodeSecret(secret)).update(signed).digest("base64");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Verifies a webhook request. Accepts one secret or several at once (for key rotation: while both
 * the old and the new secret are active, a webhook signed with either must verify).
 *
 * The raw, EXACT body Duva sent must be passed as-is: re-encoding a parsed-then-re-serialized JSON
 * body changes its bytes and invalidates every signature (see your framework's raw-body option,
 * documented per-framework in `docs/api.md`).
 */
export function verifyWebhookSignature(
  secrets: string | readonly string[],
  headers: WebhookHeaders,
  rawBody: string | Uint8Array,
  options: VerifyOptions = {},
): boolean {
  const id = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Date.now() / 1000;
  const at = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(at) || Math.abs(now - at) > tolerance) return false;

  const secretList = typeof secrets === "string" ? [secrets] : secrets;
  const expected = secretList.map((secret) => expectedSignature(secret, id, timestamp, rawBody));

  // `webhook-signature` may carry several space-separated `v1,<signature>` entries (Duva sends
  // one; a sender that itself rotates its OWN signing key mid-flight could send more): any match
  // against any of your active secrets is accepted.
  for (const part of signatureHeader.split(" ")) {
    const [version, signature] = part.split(",", 2);
    if (version !== "v1" || !signature) continue;
    // Byte-for-byte comparison of the two base64-encoded TEXTS: two equal signatures are
    // identical as text too, so this never needs to decode (or trust) attacker-controlled input.
    if (expected.some((candidate) => constantTimeEqual(signature, candidate))) return true;
  }
  return false;
}

/** {@link verifyWebhookSignature}, then parses the body: throws {@link WebhookSignatureError} on
 * a bad signature rather than returning a boolean, for call sites that want to `throw` on
 * failure. Never includes the secret or the raw body in the error message. */
export function constructEvent(
  secrets: string | readonly string[],
  headers: WebhookHeaders,
  rawBody: string | Uint8Array,
  options: VerifyOptions = {},
): WebhookEvent {
  if (!verifyWebhookSignature(secrets, headers, rawBody, options)) {
    throw new WebhookSignatureError("webhook signature verification failed");
  }
  const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  return JSON.parse(text) as WebhookEvent;
}

/**
 * Builds a validly signed request FOR YOUR OWN TESTS: the headers a real Duva webhook delivery
 * would carry for `body`, signed with `secret` as of `timestamp` (Unix seconds; defaults to now).
 * Never used by the library itself to send anything: Duva is the only real sender.
 */
export function signWebhookRequest(
  secret: string,
  id: string,
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const ts = String(timestamp);
  return {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${expectedSignature(secret, id, ts, body)}`,
  };
}
