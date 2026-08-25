import { afterEach, describe, expect, it } from "vitest";
import {
  clearUrnMetadataCache,
  invalidateUrnMetadataCache,
  urnMetadataCacheForScope,
  type CachedUrnMetadata,
} from "@/features/search/utils/urnMetadataCache";

const metadata = (title: string) => ({ title }) as CachedUrnMetadata;

afterEach(() => {
  clearUrnMetadataCache();
});

describe("URN metadata cache", () => {
  it("separates entries by organization and user", () => {
    const urn = "urn:uniffy:content:NOTE:shared-id";
    urnMetadataCacheForScope("organization-a", "user-a").set(urn, metadata("Tenant A"));

    expect(urnMetadataCacheForScope("organization-a", "user-a").get(urn)?.title).toBe("Tenant A");
    expect(urnMetadataCacheForScope("organization-b", "user-a").has(urn)).toBe(false);
    expect(urnMetadataCacheForScope("organization-a", "user-b").has(urn)).toBe(false);
  });

  it("detaches an in-flight request's cache when all scopes are cleared", () => {
    const urn = "urn:uniffy:content:NOTE:late-response";
    const requestCache = urnMetadataCacheForScope("organization-a", "user-a");

    clearUrnMetadataCache();
    requestCache.set(urn, metadata("Stale tenant title"));

    expect(urnMetadataCacheForScope("organization-a", "user-a").has(urn)).toBe(false);
  });

  it("invalidates matching URNs in every scope", () => {
    const urn = "urn:uniffy:content:NOTE:updated";
    const otherUrn = "urn:uniffy:content:NOTE:unchanged";
    const firstCache = urnMetadataCacheForScope("organization-a", "user-a");
    const secondCache = urnMetadataCacheForScope("organization-b", "user-a");
    firstCache.set(urn, metadata("First"));
    firstCache.set(otherUrn, metadata("Other"));
    secondCache.set(urn, metadata("Second"));

    invalidateUrnMetadataCache([urn]);

    expect(firstCache.has(urn)).toBe(false);
    expect(secondCache.has(urn)).toBe(false);
    expect(firstCache.has(otherUrn)).toBe(true);
  });
});
