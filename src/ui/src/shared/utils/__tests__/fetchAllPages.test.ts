import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, type FetchedPage } from "@/shared/utils/fetchAllPages";

interface Row {
  id: string;
}

function rows(...ids: string[]): Row[] {
  return ids.map((id) => ({ id }));
}

const byId = { key: (row: Row) => row.id };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("fetchAllPages", () => {
  it("makes one request when everything fits on the first page", async () => {
    const fetchPage = vi.fn(async () => ({ items: rows("a", "b"), totalPages: 1 }));
    await expect(fetchAllPages(fetchPage, byId)).resolves.toEqual(rows("a", "b"));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("returns the first page when the server reports no pages", async () => {
    const fetchPage = vi.fn(async () => ({ items: [] as Row[], totalPages: 0 }));
    await expect(fetchAllPages(fetchPage, byId)).resolves.toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("keeps page order when later pages resolve first", async () => {
    const pageTwo = deferred<FetchedPage<Row>>();
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 1) return { items: rows("a"), totalPages: 3 };
      if (page === 2) return pageTwo.promise;
      return { items: rows("c"), totalPages: 3 };
    });

    const result = fetchAllPages(fetchPage, byId);
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(3));
    pageTwo.resolve({ items: rows("b"), totalPages: 3 });

    await expect(result).resolves.toEqual(rows("a", "b", "c"));
  });

  it("never runs more requests at once than the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchPage = async (page: number): Promise<FetchedPage<Row>> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { items: rows(`row-${page}`), totalPages: 10 };
    };

    const result = await fetchAllPages(fetchPage, { ...byId, concurrency: 3 });

    expect(result).toHaveLength(10);
    expect(peak).toBe(3);
  });

  it("keeps a row once when it shifts across a page boundary", async () => {
    const fetchPage = vi.fn(async (page: number) =>
      page === 1
        ? { items: rows("a", "b"), totalPages: 2 }
        : { items: rows("b", "c"), totalPages: 2 },
    );
    await expect(fetchAllPages(fetchPage, byId)).resolves.toEqual(rows("a", "b", "c"));
  });

  it("rejects and stops requesting when a page fails", async () => {
    const fetchPage = vi.fn(async (page: number) => {
      if (page === 2) throw new Error("page two failed");
      return { items: rows(`row-${page}`), totalPages: 20 };
    });

    await expect(fetchAllPages(fetchPage, { ...byId, concurrency: 1 })).rejects.toThrow(
      "page two failed",
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
