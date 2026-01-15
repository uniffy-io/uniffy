/**
 * URN Preview Hook
 *
 * Fetches and caches preview data for URNs.
 * Used for hover previews on mention chips.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { parseUrn, UrnType } from '@/utils/urn';
import { useAppSelector } from '@/app/hooks';
import { notesApi } from '@/features/notes/api/notesApi';

export interface UrnPreviewData {
  urn: string;
  title: string;
  description: string;
  type: UrnType;
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

/**
 * Hook for fetching URN preview data with caching.
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
      let previewData: UrnPreviewData | null = null;

      // Fetch based on type
      switch (parsed.type) {
        case UrnType.NOTE: {
          const response = await notesApi.getNote({
            noteId: parsed.id,
            organizationId,
          });
          if (response.note) {
            const note = response.note;
            // Get first 200 chars of content as description
            const contentPreview = note.content
              ? note.content
                  .replace(/^#.*\n?/gm, '') // Remove headers
                  .replace(/\[{3}[^\]]+\]{3}/g, '') // Remove mention syntax
                  .replace(/[*_~`]/g, '') // Remove markdown formatting
                  .trim()
                  .substring(0, 200)
              : '';

            previewData = {
              urn,
              title: note.title || 'Untitled',
              description: contentPreview + (contentPreview.length >= 200 ? '...' : ''),
              type: parsed.type,
              updatedAt: note.updatedAt?.toDate?.()?.toISOString() || undefined,
              createdAt: note.createdAt?.toDate?.()?.toISOString() || undefined,
            };
          }
          break;
        }

        case UrnType.USER: {
          // For users, we'd need a user API - for now use placeholder
          previewData = {
            urn,
            title: 'User',
            description: 'User profile',
            type: parsed.type,
          };
          break;
        }

        default: {
          // Generic fallback - just show type info
          previewData = {
            urn,
            title: parsed.type.charAt(0).toUpperCase() + parsed.type.slice(1),
            description: `${parsed.type} content`,
            type: parsed.type,
          };
        }
      }

      if (previewData) {
        // Cache the result
        previewCache.set(urn, previewData);
        setPreview(previewData);
      }
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
  const urn = `urn:uwos:content:NOTE:${noteId}`;
  previewCache.delete(urn);
}
