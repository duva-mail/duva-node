import { randomUUID } from "node:crypto";
import type { components } from "../generated/openapi.js";
import { assertAttachmentLimits, type Attachment } from "./attachments.js";
import { type ClientOptions, Transport } from "./http.js";
import { type Page, paginate, type PaginateOptions } from "./pagination.js";

type Schemas = components["schemas"];
export type Message = Schemas["Message"];
export type MessageAccepted = Schemas["MessageAccepted"];
export type Tracking = Schemas["Tracking"];
export type Event = Schemas["Event"];
export type EventType = Event["type"];
export type Suppression = Schemas["Suppression"];
export type SuppressionReason = Suppression["reason"];
export type Webhook = Schemas["Webhook"];
export type WebhookDelivery = Schemas["WebhookDelivery"];
export type Stats = Schemas["Stats"];
export type StatsPeriod = Schemas["StatsPeriod"];

export interface SendMessageInput {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  tags?: string[];
  tracking?: { opens?: boolean; clicks?: boolean };
  replyTo?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
  attachments?: Attachment[];
  /** Unique per domain. A UUID is generated and used when omitted (see
   * `docs/bibliotheques-clientes.md` §3.3): a network-level retry of the SAME call can then never
   * create a duplicate message, but two separate calls each get their own random key, so they are
   * NOT deduplicated against each other: pass your own stable key for that (e.g. an order id). */
  idempotencyKey?: string;
}

export interface SendMessageResult extends MessageAccepted {
  /** `true` when this answer replays an earlier identical request (the `Idempotent-Replayed`
   * response header). */
  replayed: boolean;
  /** Address of the message (`GET /v1/{domain}/messages/{id}`), from the `Location` header. */
  location: string | null;
}

export interface ListEventsParams {
  messageId?: string;
  type?: EventType;
  recipient?: string;
  since?: Date;
  limit?: number;
  cursor?: string;
}

export interface ListSuppressionsParams {
  reason?: SuppressionReason;
  limit?: number;
  cursor?: string;
}

export interface CreateWebhookInput {
  url: string;
  /** Empty or omitted: every event type. */
  events?: EventType[];
}

export interface GetStatsParams {
  granularity?: "day" | "hour";
  since?: Date;
  until?: Date;
}

/**
 * A Duva client, bound to one domain and its API key.
 *
 * ```ts
 * import { Duva } from "duva-mail";
 * const duva = new Duva({ apiKey: "dv_...", domain: "example.com" });
 * const message = await duva.messages.send({
 *   from: "Example <notifications@example.com>",
 *   to: ["client@example.org"],
 *   subject: "Your order",
 *   text: "Thank you for your order.",
 * });
 * ```
 */
export class Duva {
  private readonly transport: Transport;

  constructor(options: ClientOptions = {}) {
    this.transport = new Transport(options);
  }

  readonly messages = {
    /** Accepts a message for delivery. Always asynchronous: `queued` never confirms a delivery,
     * only that the message was validated. Read the outcome with {@link messages.get},
     * {@link events.list}, or a webhook. */
    send: async (input: SendMessageInput): Promise<SendMessageResult> => {
      if (input.attachments?.length) assertAttachmentLimits(input.attachments);
      const idempotencyKey = input.idempotencyKey ?? randomUUID();
      const body: Schemas["SendMessageRequest"] = {
        from: input.from,
        to: input.to,
        subject: input.subject,
        ...(input.html !== undefined && { html: input.html }),
        ...(input.text !== undefined && { text: input.text }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.tracking !== undefined && {
          tracking: { opens: input.tracking.opens ?? false, clicks: input.tracking.clicks ?? false },
        }),
        ...(input.replyTo !== undefined && { reply_to: input.replyTo }),
        ...(input.headers !== undefined && { headers: input.headers }),
        ...(input.metadata !== undefined && { metadata: input.metadata }),
        ...(input.attachments !== undefined && {
          attachments: input.attachments.map((attachment) => attachment.data),
        }),
      };
      const { data, headers } = await this.transport.request<MessageAccepted>({
        method: "POST",
        path: `${this.transport.domainPath}/messages`,
        body,
        idempotencyKey,
        safeRetry: true, // protected by the idempotency key above
      });
      return {
        ...data,
        replayed: headers.get("idempotent-replayed") === "true",
        location: headers.get("location"),
      };
    },

    /** The message's status and each recipient's status. */
    get: async (id: string): Promise<Message> => {
      const { data } = await this.transport.request<Message>({
        method: "GET",
        path: `${this.transport.domainPath}/messages/${encodeURIComponent(id)}`,
        safeRetry: true,
      });
      return data;
    },
  };

  readonly events = {
    /** One page of delivery events, most recent first. */
    list: async (params: ListEventsParams = {}): Promise<Page<Event>> => {
      const { data } = await this.transport.request<Schemas["EventPage"]>({
        method: "GET",
        path: `${this.transport.domainPath}/events`,
        query: {
          message_id: params.messageId,
          type: params.type,
          recipient: params.recipient,
          since: params.since?.toISOString(),
          limit: params.limit,
          cursor: params.cursor,
        },
        safeRetry: true,
      });
      return data;
    },

    /** Every delivery event, most recent first, following `next_cursor` automatically. */
    listAll: (
      params: Omit<ListEventsParams, "cursor"> = {},
      options?: PaginateOptions,
    ): AsyncGenerator<Event, void, void> =>
      paginate((cursor) => this.events.list({ ...params, ...(cursor !== undefined && { cursor }) }), options),
  };

  readonly suppressions = {
    /** One page of suppressed addresses, most recent first. */
    list: async (params: ListSuppressionsParams = {}): Promise<Page<Suppression>> => {
      const { data } = await this.transport.request<Schemas["SuppressionPage"]>({
        method: "GET",
        path: `${this.transport.domainPath}/suppressions`,
        query: { reason: params.reason, limit: params.limit, cursor: params.cursor },
        safeRetry: true,
      });
      return data;
    },

    /** Every suppressed address, most recent first, following `next_cursor` automatically. */
    listAll: (
      params: Omit<ListSuppressionsParams, "cursor"> = {},
      options?: PaginateOptions,
    ): AsyncGenerator<Suppression, void, void> =>
      paginate((cursor) => this.suppressions.list({ ...params, ...(cursor !== undefined && { cursor }) }), options),

    /** Adds an address by hand (reason `manual`): it receives nothing more from this domain.
     * Naturally idempotent: adding an already-suppressed address changes nothing. */
    add: async (email: string): Promise<Suppression> => {
      const { data } = await this.transport.request<Suppression>({
        method: "POST",
        path: `${this.transport.domainPath}/suppressions`,
        body: { email } satisfies Schemas["AddSuppressionRequest"],
        safeRetry: false, // the outcome of a timed-out first attempt is unknown
      });
      return data;
    },

    /** Removes an address from the list: it may receive mail again. Throws {@link NotFoundError}
     * if it was not on the list. */
    remove: async (email: string): Promise<void> => {
      await this.transport.request<unknown>({
        method: "DELETE",
        path: `${this.transport.domainPath}/suppressions/${encodeURIComponent(email)}`,
        safeRetry: false, // the outcome of a timed-out first attempt is unknown
      });
    },
  };

  readonly webhooks = {
    /** Registers an endpoint. The response carries the signing `secret` (`whsec_...`): shown
     * ONCE, store it to verify signatures (see `verifyWebhookSignature`). Each call creates a
     * DISTINCT endpoint, never retried automatically. */
    create: async (input: CreateWebhookInput): Promise<Webhook> => {
      const { data } = await this.transport.request<Webhook>({
        method: "POST",
        path: `${this.transport.domainPath}/webhooks`,
        body: { url: input.url, events: input.events ?? [] } satisfies Schemas["CreateWebhookRequest"],
        safeRetry: false, // would create a second endpoint with a second secret on a timeout
      });
      return data;
    },

    list: async (): Promise<Webhook[]> => {
      const { data } = await this.transport.request<Schemas["WebhookList"]>({
        method: "GET",
        path: `${this.transport.domainPath}/webhooks`,
        safeRetry: true,
      });
      return data.data;
    },

    get: async (id: string): Promise<Webhook> => {
      const { data } = await this.transport.request<Webhook>({
        method: "GET",
        path: `${this.transport.domainPath}/webhooks/${encodeURIComponent(id)}`,
        safeRetry: true,
      });
      return data;
    },

    delete: async (id: string): Promise<void> => {
      await this.transport.request<unknown>({
        method: "DELETE",
        path: `${this.transport.domainPath}/webhooks/${encodeURIComponent(id)}`,
        safeRetry: false, // the outcome of a timed-out first attempt is unknown
      });
    },

    /** The latest deliveries of this endpoint (`limit`: 1 to 100, 50 by default). */
    deliveries: async (id: string, limit?: number): Promise<WebhookDelivery[]> => {
      const { data } = await this.transport.request<Schemas["WebhookDeliveryList"]>({
        method: "GET",
        path: `${this.transport.domainPath}/webhooks/${encodeURIComponent(id)}/deliveries`,
        query: { limit },
        safeRetry: true,
      });
      return data.data;
    },
  };

  readonly stats = {
    /** Counters of the domain by period (UTC). Defaults to the last 30 days (or 24 hours, by
     * hour). At most 366 days, or 7 days by hour. */
    get: async (params: GetStatsParams = {}): Promise<Stats> => {
      const { data } = await this.transport.request<Stats>({
        method: "GET",
        path: `${this.transport.domainPath}/stats`,
        query: {
          granularity: params.granularity,
          since: params.since?.toISOString(),
          until: params.until?.toISOString(),
        },
        safeRetry: true,
      });
      return data;
    },
  };

  /** `GET /health`, without authentication: `{status: "ok"}` when the service works. Throws
   * {@link ServerError} on a `503` (its database is unreachable). */
  async health(): Promise<{ status: string }> {
    const { data } = await this.transport.request<{ status: string }>({
      method: "GET",
      path: "/health",
      safeRetry: true,
    });
    return data;
  }
}
