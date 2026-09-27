export { Duva } from "./client.js";
export type {
  CreateWebhookInput,
  Event,
  EventType,
  GetStatsParams,
  ListEventsParams,
  ListSuppressionsParams,
  Message,
  MessageAccepted,
  SendMessageInput,
  SendMessageResult,
  Stats,
  StatsPeriod,
  Suppression,
  SuppressionReason,
  Tracking,
  Webhook,
  WebhookDelivery,
} from "./client.js";

export type { ClientOptions } from "./http.js";
export type { Page, PaginateOptions } from "./pagination.js";

export {
  AuthenticationError,
  ConflictError,
  DuvaConnectionError,
  DuvaError,
  DuvaTimeoutError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ValidationError,
  WebhookSignatureError,
} from "./errors.js";
export type { DuvaErrorBody } from "./errors.js";

export {
  constructEvent,
  signWebhookRequest,
  verifyWebhookSignature,
} from "./webhooks.js";
export type { VerifyOptions, WebhookEvent, WebhookHeaders } from "./webhooks.js";

export { Attachment } from "./attachments.js";
export { formatAddress, unsubscribeHeaders } from "./address.js";
export type { UnsubscribeOptions } from "./address.js";
