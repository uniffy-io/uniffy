import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTabOrganization,
  readTabOrganization,
  writeTabOrganization,
} from "@/features/auth/store/tabOrganizationStorage";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
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

describe("tabOrganizationStorage", () => {
  it("reads back the organization written for a user", () => {
    writeTabOrganization("user-a", { id: "org-1", slug: "acme" });
    expect(readTabOrganization("user-a")).toEqual({ id: "org-1", slug: "acme" });
  });

  it("returns null when nothing was written or the value is malformed", () => {
    expect(readTabOrganization("user-a")).toBeNull();
    values.set("uniffy:tab-org:user-a", "{not json");
    expect(readTabOrganization("user-a")).toBeNull();
    values.set("uniffy:tab-org:user-a", JSON.stringify({ slug: "acme" }));
    expect(readTabOrganization("user-a")).toBeNull();
  });

  it("keeps users apart and clears only the asked user", () => {
    writeTabOrganization("user-a", { id: "org-1", slug: "acme" });
    writeTabOrganization("user-b", { id: "org-2", slug: "globex" });
    clearTabOrganization("user-a");
    expect(readTabOrganization("user-a")).toBeNull();
    expect(readTabOrganization("user-b")).toEqual({ id: "org-2", slug: "globex" });
  });
});
