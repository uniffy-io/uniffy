/**
 * Batched URN resolver.
 *
 * Coalesces N concurrent URN-preview lookups into a single bulk
 * `resolveUrns` RPC. Pending URNs accumulate inside a microtask;
 * when the microtask flushes, one round-trip resolves every URN
 * collected since the last flush. The cache is process-wide so
 * remounting components does not re-fetch.
 */

import { useCallback } from 'react';
import { searchApi } from '@/features/search';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { SearchResultType } from '@uniffy/proto/search/v1/search_pb';
import { getContentTypeLabel } from '@/config/theme/contentTypes';
import { useAppSelector } from '@/app/hooks';

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

const previewCache = new Map<string, UrnPreviewData>();

let pendingByUrn = new Map<string, Array<(data: UrnPreviewData | null) => void>>();
let pendingOrgId: string | null = null;
let scheduled = false;

function searchResultTypeToUrnType(type: SearchResultType): UrnType {
  switch (type) {
    case SearchResultType.NOTE: return UrnType.NOTE;
    case SearchResultType.FILE: return UrnType.FILE;
    case SearchResultType.CHAT: return UrnType.CHAT;
    case SearchResultType.USER: return UrnType.USER;
    case SearchResultType.CALENDAR_EVENT: return UrnType.CALENDAR_EVENT;
    case SearchResultType.PROJECT: return UrnType.PROJECT;
    case SearchResultType.TASK: return UrnType.TASK;
    case SearchResultType.AGENT: return UrnType.AGENT;
    case SearchResultType.PROMPT: return UrnType.PROMPT;
    case SearchResultType.CHAT_MESSAGE: return UrnType.CHAT_MESSAGE;
    case SearchResultType.ROOM: return UrnType.ROOM;
    default: return UrnType.UNKNOWN;
  }
}

async function flush(): Promise<void> {
  scheduled = false;
  const consumers = pendingByUrn;
  const orgId = pendingOrgId;
  pendingByUrn = new Map();
  pendingOrgId = null;

  if (!orgId || consumers.size === 0) {
    for (const callbacks of consumers.values()) {
      for (const cb of callbacks) cb(null);
    }
    return;
  }

  const urns = Array.from(consumers.keys());
  let resolved: Record<string, {
    title?: string;
    description?: string;
    type: SearchResultType;
    url?: string;
    metadata?: Record<string, string>;
  }> | undefined;

  try {
    const resp = await searchApi.resolveUrns({ organizationId: orgId, urns });
    resolved = resp.resolved;
  } catch {
    resolved = undefined;
  }

  for (const [urn, callbacks] of consumers.entries()) {
    const r = resolved?.[urn];
    let data: UrnPreviewData | null = null;
    if (r) {
      const parsed = parseUrn(urn);
      data = {
        urn,
        title: r.title || getContentTypeLabel(parsed.type),
        description: r.description || '',
        type: searchResultTypeToUrnType(r.type),
        url: r.url,
        updatedAt: r.metadata?.['updated_at'] || undefined,
        metadata: r.metadata,
      };
      previewCache.set(urn, data);
    } else {
      const parsed = parseUrn(urn);
      data = parsed.isValid
        ? {
            urn,
            title: getContentTypeLabel(parsed.type),
            description: `${parsed.type} content`,
            type: parsed.type,
          }
        : null;
    }
    for (const cb of callbacks) cb(data);
  }
}

export function resolveUrnBatched(
  urn: string,
  organizationId: string,
): Promise<UrnPreviewData | null> {
  const cached = previewCache.get(urn);
  if (cached) return Promise.resolve(cached);

  return new Promise<UrnPreviewData | null>((resolve) => {
    let bucket = pendingByUrn.get(urn);
    if (!bucket) {
      bucket = [];
      pendingByUrn.set(urn, bucket);
    }
    bucket.push(resolve);
    pendingOrgId = organizationId;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
}

export function useBatchedSubjectResolver(): (urn: string) => Promise<UrnPreviewData | null> {
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  return useCallback(
    (urn: string) =>
      organizationId ? resolveUrnBatched(urn, organizationId) : Promise.resolve(null),
    [organizationId],
  );
}

export function getCachedPreview(urn: string): UrnPreviewData | undefined {
  return previewCache.get(urn);
}

export function clearPreviewCache(): void {
  previewCache.clear();
}

export function invalidatePreviewCache(urn: string): void {
  previewCache.delete(urn);
}

export function invalidateNotePreviewCache(noteId: string): void {
  previewCache.delete(`urn:uniffy:content:NOTE:${noteId}`);
}

export function getResolvedUrl(urn: string): string | null {
  return previewCache.get(urn)?.url ?? null;
}
