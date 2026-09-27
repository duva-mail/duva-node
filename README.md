# Duva for Node.js

The official [Duva](https://duva.ca) client library for Node.js and TypeScript. Duva is a
transactional email API hosted in Canada.

```bash
npm install duva-mail
```

Requires Node.js 22 or later.

## Sending a message

```ts
import { Duva } from "duva-mail";

const duva = new Duva({ apiKey: "dv_...", domain: "example.com" }); // or DUVA_API_KEY / DUVA_DOMAIN

const message = await duva.messages.send({
  from: "Example <notifications@example.com>",
  to: ["client@example.org"],
  subject: "Your order",
  text: "Thank you for your order.",
});

console.log(message.id, message.status); // "queued": always asynchronous
```

## Reading events and pagination

```ts
for await (const event of duva.events.listAll({ type: "bounced" })) {
  console.log(event.type, event.data.recipient);
}
```

`events.list()` and `suppressions.list()` return one page (`{ data, next_cursor }`);
`events.listAll()` and `suppressions.listAll()` are async generators that follow `next_cursor`
for you, optionally bounded with `{ maxItems }`.

## Verifying a webhook

```ts
import { constructEvent, WebhookSignatureError } from "duva-mail";

app.post("/hooks/duva", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = constructEvent(process.env.DUVA_WEBHOOK_SECRET!, req.headers, req.body);
    console.log(event.type, event.data.message_id);
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof WebhookSignatureError) return res.sendStatus(400);
    throw error;
  }
});
```

`req.body` must be the **raw** bytes (`express.raw`, not `express.json`): re-encoding a parsed body
changes it and invalidates the signature. Rotating your webhook secret? Pass an array —
`constructEvent([oldSecret, newSecret], ...)` — while both are active.

## Errors

Every error Duva answers with is a `DuvaError` subclass; rely on `.code` (the contract), never on
`.message` (its wording can change):

```ts
import { NotFoundError, QuotaExceededError, ValidationError } from "duva-mail";

try {
  await duva.messages.send({ /* ... */ });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(error.fields); // [{ field: "to[0]", message: "..." }]
  } else if (error instanceof QuotaExceededError) {
    console.error(`retry in ${error.retryAfter}s`);
  } else if (error instanceof NotFoundError) {
    // the API key, domain or resource could not be found
  }
  throw error;
}
```

Network failures and timeouts throw `DuvaConnectionError` / `DuvaTimeoutError` instead (no HTTP
response was ever received). Reads and `messages.send` (idempotency-key protected) are retried
automatically on a transient failure; `suppressions.add`/`remove` and `webhooks.create`/`delete`
are not, because the outcome of a timed-out first attempt is unknown. A `429 quota_exceeded` is
never retried automatically (its `Retry-After` can be hours); a `429 rate_limited` is, as long as
the wait fits within `maxRetryWaitSeconds` (30s by default).

## Attachments

```ts
import { Attachment } from "duva-mail";

const attachment = await Attachment.fromFile("./invoice.pdf");
await duva.messages.send({ /* ... */, attachments: [attachment] });
```

`Attachment.fromBytes(filename, bytes, { contentType?, contentId? })` works from data already in
memory; `contentId` turns the attachment into an inline image the HTML references with `cid:`.

## Configuration

| Option | Default | |
|---|---|---|
| `apiKey` | `DUVA_API_KEY` | Required. |
| `domain` | `DUVA_DOMAIN` | Required: the domain this key was created for. |
| `baseUrl` | `https://api.duva.ca` | |
| `timeout` | `10000` (ms) | |
| `maxRetries` | `2` | Network failures / `5xx` on a safe-to-retry call. |
| `maxRetryWaitSeconds` | `30` | A `429 rate_limited` with a longer wait is not retried. |
| `language` | unset | `"en"` or `"fr"`: the language of `error.message`. |
| `fetch` | global `fetch` | Inject your own (proxying, tests). |

## Full reference

The complete API surface, generated types and the OpenAPI specification this library is generated
from: <https://duva.ca/en/docs> and <https://duva.ca/openapi.json>.

## Development

```bash
npm install
npm run generate:local   # regenerate generated/openapi.d.ts from a local ../duva checkout
npm run typecheck
npm test                 # unit tests
npm run test:conformance # fetches duva-mail/duva-conformance and runs the conformance suite
npm run build
```

This library's request/response types are generated from Duva's OpenAPI specification
(`generated/`, never edited by hand); the client itself (retries, pagination, errors, webhooks) is
hand-written and checked against the shared fixtures published in
[`duva-mail/duva-conformance`](https://github.com/duva-mail/duva-conformance).

## License

MIT, see [LICENSE](./LICENSE).
