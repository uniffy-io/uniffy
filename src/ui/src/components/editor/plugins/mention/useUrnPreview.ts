/**
 * URN Preview Hook
 *
 * Thin per-component wrapper around the batched resolver in
 * `@/components/mention/useBatchedSubjectResolver`. The actual
 * fetch coalescing, cache, and resolveUrns RPC live there;
 * this hook only owns the per-consumer { preview, isLoading,
 * error } state.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAppSelector } from '@/app/hooks';
import {
  resolveUrnBatched,
  getCachedPreview,
  clearPreviewCache,
  invalidatePreviewCache,
  invalidateNotePreviewCache,
  getResolvedUrl,
  type UrnPreviewData,
} from '@/components/mention/useBatchedSubjectResolver';

export type { UrnPreviewData };
export {
  clearPreviewCache,
  invalidatePreviewCache,
  invalidateNotePreviewCache,
  getResolvedUrl,
};

interface UseUrnPreviewResult {
  preview: UrnPreviewData | null;
  isLoading: boolean;
  error: string | null;
  fetchPreview: (urn: string) => void;
}

export function useUrnPreview(): UseUrnPreviewResult {
  const [preview, setPreview] = useState<UrnPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const activeUrnRef = useRef<string | null>(null);

  const fetchPreview = useCallback(
    (urn: string) => {
      const cached = getCachedPreview(urn);
      if (cached) {
        activeUrnRef.current = urn;
        setPreview(cached);
        setIsLoading(false);
        setError(null);
        return;
      }

      if (!organizationId) {
        setError('No organization selected');
        return;
      }

      activeUrnRef.current = urn;
      setIsLoading(true);
      setError(null);

      resolveUrnBatched(urn, organizationId)
        .then((data) => {
          if (activeUrnRef.current !== urn) return;
          if (data) {
            setPreview(data);
          } else {
            setError('Invalid URN');
          }
          setIsLoading(false);
        })
        .catch((err) => {
          if (activeUrnRef.current !== urn) return;
          setError(err instanceof Error ? err.message : 'Failed to load preview');
          setIsLoading(false);
        });
    },
    [organizationId],
  );

  useEffect(() => {
    return () => {
      activeUrnRef.current = null;
    };
  }, []);

  return { preview, isLoading, error, fetchPreview };
}
