import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Duva } from "../../src/client.js";

interface RequestCase {
  operation_id: string;
  input: Record<string, unknown>;
  expected_request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: Record<string, unknown> | null;
  };
}

const fixture: { cases: RequestCase[] } = JSON.parse(
  await readFile("conformance/requests.json", "utf8"),
);

/** Captures the single outgoing request instead of hitting the network, and answers just enough
 * for the client call to resolve (the ASSERTION is on what was SENT, not on the fake response). */
function capturingFetch(): { fetch: typeof fetch; captured: () => Request } {
  let request: Request | undefined;
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ id: "x", status: "queued", data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { fetch, captured: () => request! };
}

const CALL: Record<string, (duva: Duva, input: Record<string, unknown>) => Promise<unknown>> = {
  sendMessage: (duva, input) =>
    duva.messages.send({
      from: input.from_ as string,
      to: input.to as string[],
      subject: input.subject as string,
      text: input.text as string,
      tags: input.tags as string[],
      metadata: input.metadata as Record<string, string>,
      idempotencyKey: input.idempotency_key as string,
    }),
  addSuppression: (duva, input) => duva.suppressions.add(input.email as string),
  createWebhook: (duva, input) =>
    duva.webhooks.create({ url: input.url as string, events: input.events as never }),
  getMessage: (duva, input) => duva.messages.get(input.id as string),
  removeSuppression: (duva, input) => duva.suppressions.remove(input.email as string),
};

describe("requests sent against duva-mail/duva-conformance", () => {
  it.each(fixture.cases)("$operation_id", async (testCase) => {
    const { fetch, captured } = capturingFetch();
    const duva = new Duva({
      apiKey: testCase.input.api_key as string,
      domain: testCase.input.domain as string,
      baseUrl: "https://api.example.com",
      fetch,
    });
    await CALL[testCase.operation_id]!(duva, testCase.input);

    const request = captured();
    const url = new URL(request.url);
    expect(request.method).toBe(testCase.expected_request.method);
    expect(url.pathname).toBe(testCase.expected_request.path);
    for (const [name, value] of Object.entries(testCase.expected_request.headers)) {
      expect(request.headers.get(name)).toBe(value);
    }
    if (testCase.expected_request.body === null) {
      expect(await request.text()).toBe("");
    } else {
      expect(await request.json()).toEqual(testCase.expected_request.body);
    }
  });

  it("covers every operation the generator declares", () => {
    const missing = fixture.cases.map((c) => c.operation_id).filter((id) => !(id in CALL));
    expect(missing).toEqual([]);
  });
});
