export interface FetchedPage<T> {
  items: T[];
  /** Page count reported by the server, which may clamp the requested page size. */
  totalPages: number;
}

interface FetchAllPagesOptions<T> {
  key: (item: T) => string;
  /** Requests in flight at once after the first page. */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Loads page 1, then the remaining pages in parallel, in page order. Offset pages can shift while
 * other writers insert or reorder rows, so an item seen on two pages is kept once.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<FetchedPage<T>>,
  { key, concurrency = DEFAULT_CONCURRENCY }: FetchAllPagesOptions<T>,
): Promise<T[]> {
  const first = await fetchPage(1);
  const pages: T[][] = [first.items];

  let nextPage = 2;
  let failed = false;
  const worker = async () => {
    while (!failed && nextPage <= first.totalPages) {
      const page = nextPage++;
      try {
        pages[page - 1] = (await fetchPage(page)).items;
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Math.max(1, Math.min(concurrency, first.totalPages - 1));
  await Promise.all(Array.from({ length: workers }, worker));

  const seen = new Set<string>();
  const items: T[] = [];
  for (const pageItems of pages) {
    for (const item of pageItems ?? []) {
      const id = key(item);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(item);
    }
  }
  return items;
}
