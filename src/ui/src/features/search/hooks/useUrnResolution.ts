import { useState, useEffect, useRef, useCallback } from "react";
import { useAppSelector } from "@/app/hooks";
import { searchApi } from "@/features/search/api/searchApi";
import { UrnAvailability, type UrnMetadata } from "@uniffy/proto/search/v1/search_pb";
import {
  urnMetadataCacheForScope,
  type CachedUrnMetadata,
} from "@/features/search/utils/urnMetadataCache";
import { resolveUrnChunks } from "@/features/search/utils/urnResolutionChunks";

export {
  clearUrnMetadataCache,
  hydrateUrnMetadataCache,
  invalidateUrnMetadataCache,
} from "@/features/search/utils/urnMetadataCache";

export interface UrnResolutionResult {
  resolved: Map<string, Omit<UrnMetadata, "$typeName">>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useUrnResolution(urns: string[]): UrnResolutionResult {
  const [resolved, setResolved] = useState<Map<string, Omit<UrnMetadata, "$typeName">>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef(0);

  const fetchMetadata = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const currentFetchId = ++fetchIdRef.current;

    if (!organizationId || !userId || urns.length === 0) {
      setResolved(new Map());
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const urnMetadataCache = urnMetadataCacheForScope(organizationId, userId);

    const cachedResults = new Map<string, CachedUrnMetadata>();
    const urnsToFetch: string[] = [];

    for (const urn of new Set(urns.filter(Boolean))) {
      const cached = urnMetadataCache.get(urn);
      if (cached) {
        cachedResults.set(urn, cached);
      } else {
        urnsToFetch.push(urn);
      }
    }

    if (urnsToFetch.length === 0) {
      abortControllerRef.current = null;
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

    const mergedResults = new Map(cachedResults);

    try {
      const chunks: string[][] = [];
      for (let i = 0; i < urnsToFetch.length; i += 100) {
        chunks.push(urnsToFetch.slice(i, i + 100));
      }
      await resolveUrnChunks(chunks, {
        signal: controller.signal,
        resolve: (chunk, signal) =>
          searchApi.resolveUrns({ organizationId, urns: chunk }, { signal }),
        onResolved: (response) => {
          if (currentFetchId !== fetchIdRef.current || controller.signal.aborted) return;
          for (const [urn, metadata] of Object.entries(response.resolved ?? {})) {
            const plainMetadata = metadata as Omit<UrnMetadata, "$typeName">;
            // Restricted, deleted, and unavailable answers are transient or
            // retryable. Caching them makes the retry a cache hit and pins a
            // placeholder label for the rest of the session.
            if (plainMetadata.availability === UrnAvailability.AVAILABLE) {
              urnMetadataCache.set(urn, plainMetadata);
            }
            mergedResults.set(urn, plainMetadata);
          }
          setResolved(new Map(mergedResults));
        },
      });

      if (currentFetchId !== fetchIdRef.current || controller.signal.aborted) return;
      setError(null);
    } catch (err) {
      if (controller.signal.aborted || currentFetchId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to resolve URNs");
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        abortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  }, [organizationId, userId, urns]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetching the URN batch is the whole point of this effect; the setStates it reaches are the async results, not derived render state
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
