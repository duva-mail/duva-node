import { describe, expect, it } from "vitest";
import { Attachment, assertAttachmentLimits } from "../../src/attachments.js";

describe("Attachment.fromBytes", () => {
  it("base64-encodes the bytes and defaults content_type/content_id to null", () => {
    const attachment = Attachment.fromBytes("a.txt", new TextEncoder().encode("hi"));
    expect(attachment.data).toEqual({
      filename: "a.txt",
      content: Buffer.from("hi").toString("base64"),
      content_type: null,
      content_id: null,
    });
  });

  it("carries an explicit content type and inline content id", () => {
    const attachment = Attachment.fromBytes("logo.png", new Uint8Array([1, 2, 3]), {
      contentType: "image/png",
      contentId: "logo",
    });
    expect(attachment.data.content_type).toBe("image/png");
    expect(attachment.data.content_id).toBe("logo");
  });

  it("refuses a filename with a path", () => {
    expect(() => Attachment.fromBytes("../a.txt", new Uint8Array())).toThrow(TypeError);
  });

  it("refuses an executable extension", () => {
    expect(() => Attachment.fromBytes("virus.exe", new Uint8Array())).toThrow(TypeError);
  });
});

describe("assertAttachmentLimits", () => {
  it("accepts a message within the limits", () => {
    const attachments = [Attachment.fromBytes("a.txt", new TextEncoder().encode("hi"))];
    expect(() => assertAttachmentLimits(attachments)).not.toThrow();
  });

  it("refuses more than 10 attachments", () => {
    const attachments = Array.from({ length: 11 }, (_, i) =>
      Attachment.fromBytes(`a${i}.txt`, new Uint8Array()),
    );
    expect(() => assertAttachmentLimits(attachments)).toThrow(TypeError);
  });

  it("refuses more than 5 MB decoded in total", () => {
    const big = Attachment.fromBytes("big.bin", new Uint8Array(5 * 1024 * 1024 + 1));
    expect(() => assertAttachmentLimits([big])).toThrow(TypeError);
  });
});
