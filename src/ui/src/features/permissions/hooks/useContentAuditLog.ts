import { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { fetchContentAuditLog } from "@/features/permissions/store/permissionsThunks";

export interface AuditLogFilters {
  actorUserId?: string;
  action?: number;
}

export function useContentAuditLog(contentType: number, contentId: string) {
  const dispatch = useAppDispatch();
  const key = `${contentType}:${contentId}`;
  const entry = useAppSelector((s) => s.permissions.byContent[key]);
  const [filters, setFilters] = useState<AuditLogFilters>({});

  const load = useCallback(
    (page: number) =>
      dispatch(
        fetchContentAuditLog({
          contentType,
          contentId,
          page,
          pageSize: 25,
          actorUserId: filters.actorUserId,
          action: filters.action,
        }),
      ).unwrap(),
    [dispatch, contentType, contentId, filters],
  );

  useEffect(() => {
    if (contentId) {
      void load(1);
    }
  }, [contentId, load]);

  const auditCursor = entry?.auditCursor ?? null;
  const loadMore = useCallback(() => {
    if (auditCursor) {
      void load(auditCursor);
    }
  }, [auditCursor, load]);

  const reset = useCallback(() => {
    void load(1);
  }, [load]);

  return {
    events: entry?.auditEvents ?? [],
    loading: entry?.loading.audit ?? false,
    error: entry?.errors.audit ?? null,
    hasMore: entry?.auditCursor != null,
    loadMore,
    reset,
    filters,
    setFilters,
  };
}
