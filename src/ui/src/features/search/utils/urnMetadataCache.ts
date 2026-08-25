import type { UrnMetadata } from "@uniffy/proto/search/v1/search_pb";

export type CachedUrnMetadata = Omit<UrnMetadata, "$typeName">;

const cachesByScope = new Map<string, Map<string, CachedUrnMetadata>>();

function cacheScopeKey(organizationId: string, userId: string): string {
  return JSON.stringify([organizationId, userId]);
}

export function urnMetadataCacheForScope(
  organizationId: string,
  userId: string,
): Map<string, CachedUrnMetadata> {
  const scopeKey = cacheScopeKey(organizationId, userId);
  let cache = cachesByScope.get(scopeKey);
  if (!cache) {
    cache = new Map();
    cachesByScope.set(scopeKey, cache);
  }
  return cache;
}

export function clearUrnMetadataCache(): void {
  cachesByScope.clear();
}

export function invalidateUrnMetadataCache(urns: string[]): void {
  for (const cache of cachesByScope.values()) {
    for (const urn of urns) {
      cache.delete(urn);
    }
  }
}

export function hydrateUrnMetadataCache(
  organizationId: string,
  userId: string,
  entries: Array<{ urn: string; metadata: CachedUrnMetadata }>,
): void {
  const cache = urnMetadataCacheForScope(organizationId, userId);
  for (const { urn, metadata } of entries) {
    cache.set(urn, metadata);
  }
}
