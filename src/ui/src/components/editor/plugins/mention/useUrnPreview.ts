/**
 * URN Preview Hook
 *
 * Fetches and caches preview data for URNs using the unified search API.
 * Used for hover previews on mention chips.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { useAppSelector } from '@/app/hooks';
import { searchApi } from '@/features/search';
import { SearchResultType } from '@/gen/search/v1/search_pb';
import { getContentTypeLabel } from '@/config/theme/contentTypes';

export interface UrnPreviewData {
  urn: string;
  title: string;
  description: string;
  type: UrnType;
  url?: string;
  updatedAt?: string;
  createdAt?: string;
  metadata?: Record<string, string>;
}

interface UseUrnPreviewResult {
  preview: UrnPreviewData | null;
  isLoading: boolean;
  error: string | null;
  fetchPreview: (urn: string) => void;
}

// Global cache for preview data to avoid refetching
const previewCache = new Map<string, UrnPreviewData>();

// Map SearchResultType to UrnType
function searchResultTypeToUrnType(type: SearchResultType): UrnType {
  switch (type) {
    case SearchResultType.NOTE:
      return UrnType.NOTE;
    case SearchResultType.FILE:
      return UrnType.FILE;
    case SearchResultType.CHAT:
      return UrnType.CHAT;
    case SearchResultType.USER:
      return UrnType.USER;
    case SearchResultType.CALENDAR_EVENT:
      return UrnType.CALENDAR_EVENT;
    default:
      return UrnType.UNKNOWN;
  }
}

/**
 * Hook for fetching URN preview data with caching.
 * Uses the unified resolveUrns API to fetch metadata for any URN type.
 */
export function useUrnPreview(): UseUrnPreviewResult {
  const [preview, setPreview] = useState<UrnPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchPreview = useCallback(async (urn: string) => {
    // Check cache first
    const cached = previewCache.get(urn);
    if (cached) {
      setPreview(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (!organizationId) {
      setError('No organization selected');
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const parsed = parseUrn(urn);
    if (!parsed.isValid) {
      setError('Invalid URN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Use the unified resolveUrns API for all types
      const response = await searchApi.resolveUrns({
        organizationId,
        urns: [urn],
      });

      const resolved = response.resolved?.[urn];
      let previewData: UrnPreviewData;

      if (resolved) {
        // Got metadata from the search index
        previewData = {
          urn,
          title: resolved.title || getTypeLabel(parsed.type),
          description: resolved.description || '',
          type: searchResultTypeToUrnType(resolved.type),
          url: resolved.url,
          updatedAt: resolved.metadata?.['updated_at'] || undefined,
          metadata: resolved.metadata,
        };
        // Only cache successful lookups, not fallback data
        previewCache.set(urn, previewData);
      } else {
        // Fallback for URNs not in search index
        // Don't cache - the content might be indexed later
        previewData = {
          urn,
          title: getTypeLabel(parsed.type),
          description: `${parsed.type} content`,
          type: parsed.type,
        };
      }

      setPreview(previewData);
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    preview,
    isLoading,
    error,
    fetchPreview,
  };
}

/** Get a human-readable label for a URN type using centralized config */
function getTypeLabel(type: UrnType): string {
  return getContentTypeLabel(type);
}

/**
 * Clear the entire preview cache
 */
export function clearPreviewCache(): void {
  previewCache.clear();
}

/**
 * Invalidate a specific URN from the cache.
 * Call this when content is updated to ensure fresh data on next hover.
 */
export function invalidatePreviewCache(urn: string): void {
  previewCache.delete(urn);
}

/**
 * Invalidate cache for a note by ID.
 * Convenience function for use after note saves.
 */
export function invalidateNotePreviewCache(noteId: string): void {
  const urn = `urn:uniffy:content:NOTE:${noteId}`;
  previewCache.delete(urn);
}

/**
 * Get the resolved URL for a URN from the preview cache.
 * Returns the backend-provided URL path (which is correct for nested
 * resources like tasks) or falls back to urnToPath.
 */
export function getResolvedUrl(urn: string): string | null {
  const cached = previewCache.get(urn);
  return cached?.url || null;
}
