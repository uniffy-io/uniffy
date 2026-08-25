import { describe, it, expect, vi, beforeEach } from "vitest";

const searchSpy = vi.fn().mockResolvedValue({ items: [], hasMore: false, nextOffset: 0 });
const resolveUrnsSpy = vi.fn().mockResolvedValue({ resolved: {} });

vi.mock("@connectrpc/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@connectrpc/connect")>()),
  createClient: () => ({ search: searchSpy, resolveUrns: resolveUrnsSpy }),
}));

vi.mock("@/config/api", () => ({ unaryTransport: {} }));

const { searchApi } = await import("@/features/search/api/searchApi");

describe("searchApi.search", () => {
  beforeEach(() => {
    searchSpy.mockClear();
    resolveUrnsSpy.mockClear();
  });

  it("forwards the abort signal so a superseded search is cancelled", async () => {
    const controller = new AbortController();
    await searchApi.search({ organizationId: "org", query: "q" }, { signal: controller.signal });

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it("works without options", async () => {
    await searchApi.search({ organizationId: "org", query: "q" });
    expect(searchSpy.mock.calls[0][1]).toEqual({ signal: undefined });
  });
});

describe("searchApi.resolveUrns", () => {
  beforeEach(() => resolveUrnsSpy.mockClear());

  it("forwards the abort signal", async () => {
    const controller = new AbortController();
    await searchApi.resolveUrns(
      { organizationId: "org", urns: ["urn"] },
      { signal: controller.signal },
    );

    expect(resolveUrnsSpy).toHaveBeenCalledTimes(1);
    expect(resolveUrnsSpy.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});
