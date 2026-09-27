import { describe, expect, it } from "vitest";
import { formatAddress, unsubscribeHeaders } from "../../src/address.js";

describe("formatAddress", () => {
  it("returns the bare address without a name", () => {
    expect(formatAddress("a@example.com")).toBe("a@example.com");
  });

  it("wraps a name around the address", () => {
    expect(formatAddress("a@example.com", "Example")).toBe("Example <a@example.com>");
  });

  it("quotes and escapes a name containing a comma or a quote", () => {
    expect(formatAddress("a@example.com", 'Some, "Name"')).toBe(
      '"Some, \\"Name\\"" <a@example.com>',
    );
  });
});

describe("unsubscribeHeaders", () => {
  it("builds both headers for one-click unsubscribe by default", () => {
    expect(unsubscribeHeaders({ httpsUrl: "https://example.com/u" })).toEqual({
      "List-Unsubscribe": "<https://example.com/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("combines an https link and a mailto without one-click when asked", () => {
    expect(
      unsubscribeHeaders({
        httpsUrl: "https://example.com/u",
        mailto: "stop@example.com",
        oneClick: false,
      }),
    ).toEqual({ "List-Unsubscribe": "<https://example.com/u>, <mailto:stop@example.com>" });
  });

  it("a mailto-only unsubscribe never gets List-Unsubscribe-Post", () => {
    expect(unsubscribeHeaders({ mailto: "stop@example.com" })).toEqual({
      "List-Unsubscribe": "<mailto:stop@example.com>",
    });
  });

  it("throws without any destination", () => {
    expect(() => unsubscribeHeaders({})).toThrow(TypeError);
  });

  it("throws if httpsUrl is not https", () => {
    expect(() => unsubscribeHeaders({ httpsUrl: "http://example.com/u" })).toThrow(TypeError);
  });

  it("throws asking for one-click without an https link", () => {
    expect(() => unsubscribeHeaders({ mailto: "stop@example.com", oneClick: true })).toThrow(
      TypeError,
    );
  });
});
