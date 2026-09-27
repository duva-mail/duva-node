import { describe, expect, it } from "vitest";
import { paginate } from "../../src/pagination.js";

describe("paginate", () => {
  it("follows next_cursor until null, without ever fetching an extra page", async () => {
    const pages = [
      { data: [1, 2], next_cursor: "a" },
      { data: [3], next_cursor: "b" },
      { data: [4, 5], next_cursor: null },
    ];
    const seenCursors: (string | undefined)[] = [];
    async function fetchPage(cursor: string | undefined) {
      seenCursors.push(cursor);
      return pages[seenCursors.length - 1]!;
    }
    const items: number[] = [];
    for await (const item of paginate(fetchPage)) items.push(item);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(seenCursors).toEqual([undefined, "a", "b"]);
  });

  it("a single empty page yields nothing and fetches only once", async () => {
    let calls = 0;
    async function fetchPage() {
      calls += 1;
      return { data: [], next_cursor: null };
    }
    const items: unknown[] = [];
    for await (const item of paginate(fetchPage)) items.push(item);
    expect(items).toEqual([]);
    expect(calls).toBe(1);
  });

  it("maxItems stops early without fetching pages it does not need", async () => {
    let calls = 0;
    async function fetchPage(cursor: string | undefined) {
      calls += 1;
      return { data: [1, 2, 3], next_cursor: cursor === "used" ? null : "used" };
    }
    const items: number[] = [];
    for await (const item of paginate(fetchPage, { maxItems: 2 })) items.push(item);
    expect(items).toEqual([1, 2]);
    expect(calls).toBe(1); // le troisième élément de la première page n'est jamais nécessaire
  });
});
