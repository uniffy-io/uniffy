import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLastOrganizationSlug,
  readLastOrganizationSlug,
  writeLastOrganizationSlug,
} from "@/features/auth/store/lastOrganizationStorage";

let values: Map<string, string>;

beforeEach(() => {
  values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
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

describe("lastOrganizationStorage", () => {
  it("reads back the slug written for a user", () => {
    writeLastOrganizationSlug("user-a", "acme");

    expect(readLastOrganizationSlug("user-a")).toBe("acme");
    expect(values.get("uniffy:last-org:user-a")).toBe("acme");
  });

  it("returns null when nothing was remembered", () => {
    expect(readLastOrganizationSlug("user-a")).toBeNull();
  });

  it("keeps each user's memory separate", () => {
    writeLastOrganizationSlug("user-a", "acme");
    writeLastOrganizationSlug("user-b", "globex");

    expect(readLastOrganizationSlug("user-a")).toBe("acme");
    expect(readLastOrganizationSlug("user-b")).toBe("globex");
  });

  it("clears only the given user's memory", () => {
    writeLastOrganizationSlug("user-a", "acme");
    writeLastOrganizationSlug("user-b", "globex");

    clearLastOrganizationSlug("user-a");

    expect(readLastOrganizationSlug("user-a")).toBeNull();
    expect(readLastOrganizationSlug("user-b")).toBe("globex");
  });

  it("treats unavailable storage as no memory", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });

    expect(() => writeLastOrganizationSlug("user-a", "acme")).not.toThrow();
    expect(() => clearLastOrganizationSlug("user-a")).not.toThrow();
    expect(readLastOrganizationSlug("user-a")).toBeNull();
  });
});
