/**
 * Attachment helpers. The server remains the authority on the limits below (they can change): these
 * are a courtesy, so a mistake fails locally instead of after an upload.
 */

// Mirrors `services/messages.py` in the `duva` repository at the time of writing: 10 attachments,
// 5 MB decoded in total, these extensions refused. Re-check against `docs/api.md` if this drifts.
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const FORBIDDEN_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".js", ".vbs", ".vbe", ".scr", ".msi", ".msp", ".ps1", ".jar",
]); // fmt: skip

export interface AttachmentInput {
  filename: string;
  content: string; // base64
  content_type: string | null;
  content_id: string | null;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

function assertAllowedFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\")) {
    throw new TypeError(`Duva: attachment filename must not contain a path: ${filename}`);
  }
  if (FORBIDDEN_EXTENSIONS.has(extensionOf(filename))) {
    throw new TypeError(`Duva: executable attachments are refused: ${filename}`);
  }
}

export class Attachment {
  private constructor(readonly data: AttachmentInput) {}

  /** From raw bytes already in memory. */
  static fromBytes(
    filename: string,
    bytes: Uint8Array,
    options: { contentType?: string; contentId?: string } = {},
  ): Attachment {
    assertAllowedFilename(filename);
    return new Attachment({
      filename,
      content: Buffer.from(bytes).toString("base64"),
      content_type: options.contentType ?? null,
      content_id: options.contentId ?? null,
    });
  }

  /** Reads a file from disk (Node.js only). */
  static async fromFile(
    path: string,
    options: { contentType?: string; contentId?: string; filename?: string } = {},
  ): Promise<Attachment> {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    const bytes = await readFile(path);
    return Attachment.fromBytes(options.filename ?? basename(path), bytes, options);
  }
}

/** Local, courtesy-only checks: at most {@link MAX_ATTACHMENTS} attachments, at most
 * {@link MAX_TOTAL_BYTES} decoded in total. Throws `TypeError` when exceeded; the server re-checks
 * regardless. */
export function assertAttachmentLimits(attachments: readonly Attachment[]): void {
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new TypeError(`Duva: at most ${MAX_ATTACHMENTS} attachments per message`);
  }
  const totalBytes = attachments.reduce(
    (sum, attachment) => sum + Buffer.byteLength(attachment.data.content, "base64"),
    0,
  );
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new TypeError(
      `Duva: attachments are ${totalBytes} bytes decoded, over the ${MAX_TOTAL_BYTES} limit`,
    );
  }
}
