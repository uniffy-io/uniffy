/**
 * URN Resolution Hook
 *
 * Batch resolves URN metadata using the search service.
 * Provides client-side caching for instant lookups.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search/api/searchApi';
import type { UrnMetadata } from '@/gen/search/v1/search_pb';
import type { PlainMessage } from '@bufbuild/protobuf';

export interface UrnResolutionResult {
  /** Map of URN -> resolved metadata */
  resolved: Map<string, PlainMessage<UrnMetadata>>;
  /** Whether the resolution is in progress */
  isLoading: boolean;
  /** Error message if resolution failed */
  error: string | null;
  /** Manually trigger refetch */
  refetch: () => void;
}

// Global cache for resolved URN metadata
const urnMetadataCache = new Map<string, PlainMessage<UrnMetadata>>();

/**
 * Hook for batch resolving URN metadata with caching.
 *
 * @param urns - Array of URNs to resolve
 * @returns Resolution result with metadata map, loading state, and error
 */
export function useUrnResolution(urns: string[]): UrnResolutionResult {
  const [resolved, setResolved] = useState<Map<string, PlainMessage<UrnMetadata>>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef(0);

  const fetchMetadata = useCallback(async () => {
    if (!organizationId || urns.length === 0) {
      setResolved(new Map());
      setIsLoading(false);
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const currentFetchId = ++fetchIdRef.current;

    // Check cache first and filter out already-cached URNs
    const cachedResults = new Map<string, PlainMessage<UrnMetadata>>();
    const urnsToFetch: string[] = [];

    for (const urn of urns) {
      const cached = urnMetadataCache.get(urn);
      if (cached) {
        cachedResults.set(urn, cached);
      } else {
        urnsToFetch.push(urn);
      }
    }

    // If all URNs are cached, return immediately
    if (urnsToFetch.length === 0) {
      setResolved(cachedResults);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Set partial results from cache immediately
    if (cachedResults.size > 0) {
      setResolved(cachedResults);
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await searchApi.resolveUrns({
        organizationId,
        urns: urnsToFetch,
      });

      // Check if this request is still relevant
      if (currentFetchId !== fetchIdRef.current) {
        return;
      }

      // Merge with cached results
      const mergedResults = new Map(cachedResults);

      // Process response and update cache
      if (response.resolved) {
        for (const [urn, metadata] of Object.entries(response.resolved)) {
          const plainMetadata = metadata as PlainMessage<UrnMetadata>;
          urnMetadataCache.set(urn, plainMetadata);
          mergedResults.set(urn, plainMetadata);
        }
      }

      setResolved(mergedResults);
      setError(null);
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      // Check if this request is still relevant
      if (currentFetchId !== fetchIdRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to resolve URNs');
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [organizationId, urns]);

  // Fetch on mount and when URNs change
  useEffect(() => {
    fetchMetadata();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchMetadata]);

  return {
    resolved,
    isLoading,
    error,
    refetch: fetchMetadata,
  };
}

/**
 * Clear the entire URN metadata cache.
 */
export function clearUrnMetadataCache(): void {
  urnMetadataCache.clear();
}

/**
 * Invalidate specific URNs from the cache.
 * Call this when content is updated to ensure fresh data on next resolution.
 */
export function invalidateUrnMetadataCache(urns: string[]): void {
  for (const urn of urns) {
    urnMetadataCache.delete(urn);
  }
}

/**
 * Pre-populate the cache with known metadata.
 * Useful for hydrating cache from other sources.
 */
export function hydrateUrnMetadataCache(
  entries: Array<{ urn: string; metadata: PlainMessage<UrnMetadata> }>
): void {
  for (const { urn, metadata } of entries) {
    urnMetadataCache.set(urn, metadata);
  }
}
