import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search/api/searchApi';
import type { UrnMetadata } from '@uniffy/proto/search/v1/search_pb';

export interface UrnResolutionResult {
  resolved: Map<string, Omit<UrnMetadata, '$typeName'>>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const urnMetadataCache = new Map<string, Omit<UrnMetadata, '$typeName'>>();

export function useUrnResolution(urns: string[]): UrnResolutionResult {
  const [resolved, setResolved] = useState<Map<string, Omit<UrnMetadata, '$typeName'>>>(new Map());
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

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const currentFetchId = ++fetchIdRef.current;

    const cachedResults = new Map<string, Omit<UrnMetadata, '$typeName'>>();
    const urnsToFetch: string[] = [];

    for (const urn of urns) {
      const cached = urnMetadataCache.get(urn);
      if (cached) {
        cachedResults.set(urn, cached);
      } else {
        urnsToFetch.push(urn);
      }
    }

    if (urnsToFetch.length === 0) {
      setResolved(cachedResults);
      setIsLoading(false);
      setError(null);
      return;
    }

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

      if (currentFetchId !== fetchIdRef.current) {
        return;
      }

      const mergedResults = new Map(cachedResults);

      if (response.resolved) {
        for (const [urn, metadata] of Object.entries(response.resolved)) {
          const plainMetadata = metadata as Omit<UrnMetadata, '$typeName'>;
          urnMetadataCache.set(urn, plainMetadata);
          mergedResults.set(urn, plainMetadata);
        }
      }

      setResolved(mergedResults);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
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

export function clearUrnMetadataCache(): void {
  urnMetadataCache.clear();
}

/** Drop entries so the next resolution refetches after content updates. */
export function invalidateUrnMetadataCache(urns: string[]): void {
  for (const urn of urns) {
    urnMetadataCache.delete(urn);
  }
}

export function hydrateUrnMetadataCache(
  entries: Array<{ urn: string; metadata: Omit<UrnMetadata, '$typeName'> }>
): void {
  for (const { urn, metadata } of entries) {
    urnMetadataCache.set(urn, metadata);
  }
}
