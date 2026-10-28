import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import {
  clearRecentItemsForOrganization,
  clearRecentItemsForUser,
  getRecentItems,
  recordRecentItem,
} from "@/features/search/utils/recentItems";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(organizationId: string, userId: string, title: string) {
  recordRecentItem(organizationId, userId, {
    urn: `urn:uniffy:content:NOTE:${title}`,
    title,
    type: SearchResultType.NOTE,
    url: `/notes/${title}`,
  });
}

describe("recent items cleanup", () => {
  it("removes every organization's titles for the signed-out user only", () => {
    record("org-a", "user-a", "Plan");
    record("org-b", "user-a", "Budget");
    record("org-a", "user-b", "Roadmap");
    values.set("uniffy:last-org:user-a", "acme");

    clearRecentItemsForUser("user-a");

    expect(getRecentItems("org-a", "user-a")).toEqual([]);
    expect(getRecentItems("org-b", "user-a")).toEqual([]);
    expect(getRecentItems("org-a", "user-b").map((item) => item.title)).toEqual(["Roadmap"]);
    expect(values.get("uniffy:last-org:user-a")).toBe("acme");
  });

  it("removes only the lost organization's titles", () => {
    record("org-a", "user-a", "Plan");
    record("org-b", "user-a", "Budget");

    clearRecentItemsForOrganization("org-a", "user-a");

    expect(getRecentItems("org-a", "user-a")).toEqual([]);
    expect(getRecentItems("org-b", "user-a").map((item) => item.title)).toEqual(["Budget"]);
  });
});
