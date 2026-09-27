import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Duva } from "../../src/client.js";
import { DuvaConnectionError, DuvaError } from "../../src/errors.js";

interface ScriptedResponse {
  status: number | null;
  headers?: Record<string, string>;
  body?: unknown;
}

interface RetryCase {
  name: string;
  operation_id: string;
  max_retries: number;
  max_retry_wait_seconds: number;
  response_sequence: ScriptedResponse[];
  expected_attempts: number;
  expected_outcome: string;
}

const fixture: { cases: RetryCase[] } = JSON.parse(
  await readFile("conformance/retries.json", "utf8"),
);

/** Serves the scripted `response_sequence` in order, one per call; `status: null` simulates a
 * network failure (no response at all). Counts how many attempts were actually made. */
function scriptedFetch(sequence: ScriptedResponse[]): { fetch: typeof fetch; attempts: () => number } {
  let index = 0;
  const fetch = (async () => {
    const scripted = sequence[index]!;
    index += 1;
    if (scripted.status === null) throw new Error("simulated network failure");
    return new Response(scripted.body === undefined ? "" : JSON.stringify(scripted.body), {
      status: scripted.status,
      headers: scripted.headers ?? {},
    });
  }) as typeof globalThis.fetch;
  return { fetch, attempts: () => index };
}

const CALL: Record<string, (duva: Duva) => Promise<unknown>> = {
  sendMessage: (duva) =>
    duva.messages.send({ from: "a@example.com", to: ["b@example.org"], subject: "s", text: "t" }),
  getMessage: (duva) => duva.messages.get("msg_" + "a".repeat(32)),
  addSuppression: (duva) => duva.suppressions.add("b@example.org"),
  listEvents: (duva) => duva.events.list(),
};

describe("retries against duva-mail/duva-conformance", () => {
  it.each(fixture.cases)("$name", async (testCase) => {
    const { fetch, attempts } = scriptedFetch(testCase.response_sequence);
    const duva = new Duva({
      apiKey: "dv_test",
      domain: "example.com",
      baseUrl: "https://api.example.com",
      maxRetries: testCase.max_retries,
      maxRetryWaitSeconds: testCase.max_retry_wait_seconds,
      fetch,
    });
    const call = CALL[testCase.operation_id];
    expect(call, `no driver for ${testCase.operation_id}`).toBeDefined();

    if (testCase.expected_outcome === "success") {
      await expect(call!(duva)).resolves.toBeDefined();
    } else {
      const [, code] = testCase.expected_outcome.split(":");
      const error = await call!(duva).then(
        () => {
          throw new Error("expected a rejection");
        },
        (e: unknown) => e,
      );
      if (code === "server") {
        expect(error instanceof DuvaError || error instanceof DuvaConnectionError).toBe(true);
      } else {
        expect(error).toBeInstanceOf(DuvaError);
        expect((error as DuvaError).code).toBe(code);
      }
    }
    expect(attempts()).toBe(testCase.expected_attempts);
  });
});
