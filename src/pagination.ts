/** Cursor pagination, shared by `events.listAll` and `suppressions.listAll`: follows `next_cursor`
 * until it is `null`, without ever loading every page into memory at once. */

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export interface PaginateOptions {
  /** Stop after yielding this many items, even if pages remain. Unset: no limit. */
  maxItems?: number;
}

export async function* paginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, void> {
  let cursor: string | undefined;
  let yielded = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.data) {
      yield item;
      yielded += 1;
      if (options.maxItems !== undefined && yielded >= options.maxItems) return;
    }
    if (page.next_cursor === null) return;
    cursor = page.next_cursor;
  }
}
