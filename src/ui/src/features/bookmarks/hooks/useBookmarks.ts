import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  fetchBookmarkItems,
  bookmarkItemsCriteriaKey,
  toggleBookmarkSafely,
  bulkCheckBookmarks,
  type BookmarkItemsScope,
} from "@/features/bookmarks/store/bookmarksSlice";
import { bookmarkUrnsNeedingCheck } from "@/features/bookmarks/utils/bookmarkChecks";
import { bookmarkTypesToContentTypes } from "@/features/bookmarks/utils/bookmarkTypes";
import type { UrnType } from "@/shared/utils/urnTypes";

type AbortableBookmarkCheck = Promise<unknown> & { abort?: () => void };

export function useIsBookmarked(urn: string): boolean {
  return useAppSelector((state) => state.bookmarks.bookmarkedUrns[urn] ?? false);
}

export function useBookmarkToggle(urn: string) {
  const dispatch = useAppDispatch();
  const isBookmarked = useIsBookmarked(urn);
  const toggling = useAppSelector((state) => state.bookmarks.toggling[urn] ?? false);
  const checking = useAppSelector((state) => state.bookmarks.checkingUrns[urn] ?? false);

  const toggle = useCallback(() => {
    dispatch(toggleBookmarkSafely(urn));
  }, [dispatch, urn]);

  return {
    isBookmarked,
    toggling: toggling || checking,
    toggle,
  };
}

export function useBookmarkStatuses(urns: string[]): void {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  // A selector body runs on every dispatched action, so the sort and serialize that
  // used to live inside one made every store update O(n log n) over every visible URN.
  // Only the raw list identity and the two status maps can change the answer.
  const sourceUrnKey = urns.join(",");
  const sourceUrns = useMemo(
    () => [...new Set(sourceUrnKey.split(",").filter(Boolean))].sort(),
    [sourceUrnKey],
  );
  const checkedUrns = useAppSelector((state) => state.bookmarks.checkedUrns);
  const checkingUrns = useAppSelector((state) => state.bookmarks.checkingUrns);
  const pendingUrns = useMemo(
    () => bookmarkUrnsNeedingCheck(sourceUrns, checkedUrns, checkingUrns),
    [sourceUrns, checkedUrns, checkingUrns],
  );
  const urnKey = pendingUrns.join(",");
  const requestsRef = useRef(new Set<AbortableBookmarkCheck>());
  const lastAttemptedKeyRef = useRef<string | null>(null);

  // A failed check makes its URNs unknown again; only a changed visible set starts another pass.
  useEffect(() => {
    lastAttemptedKeyRef.current = null;
  }, [organizationId, sourceUrnKey]);

  useEffect(() => {
    if (!organizationId || pendingUrns.length === 0) return;
    const attemptKey = `${organizationId}:${urnKey}`;
    if (lastAttemptedKeyRef.current === attemptKey) return;
    lastAttemptedKeyRef.current = attemptKey;
    const request = dispatch(bulkCheckBookmarks(pendingUrns)) as AbortableBookmarkCheck;
    requestsRef.current.add(request);
    void request.finally(() => requestsRef.current.delete(request));
  }, [dispatch, organizationId, urnKey, pendingUrns]);

  useEffect(() => {
    const requests = requestsRef.current;
    return () => {
      for (const request of requests) request.abort?.();
      requests.clear();
    };
  }, [organizationId]);
}

export function useBookmarkItems(
  scope: BookmarkItemsScope,
  options: { types?: UrnType[]; pageSize?: number } = {},
) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const bucket = useAppSelector((state) => state.bookmarks.resolved[scope]);
  const resolvedRevision = useAppSelector((state) => state.bookmarks.resolvedRevision);
  const manualRequestRef = useRef<{ abort?: () => void } | null>(null);

  const pageSize = options.pageSize;
  const typesKey = (options.types ?? []).join(",");

  const contentTypes = useMemo(
    () => bookmarkTypesToContentTypes(typesKey ? (typesKey.split(",") as UrnType[]) : []),
    [typesKey],
  );
  const criteriaKey = useMemo(
    () => bookmarkItemsCriteriaKey({ contentTypes, pageSize }),
    [contentTypes, pageSize],
  );
  const bucketMatchesCriteria = bucket.criteriaKey === criteriaKey;

  useEffect(() => {
    if (!organizationId) return;

    const promise = dispatch(fetchBookmarkItems({ scope, contentTypes, pageSize }));

    return () => {
      promise.abort?.();
      manualRequestRef.current?.abort?.();
      manualRequestRef.current = null;
    };
  }, [dispatch, organizationId, scope, contentTypes, pageSize, resolvedRevision]);

  const loadMore = useCallback(() => {
    if (!bucketMatchesCriteria || !bucket.nextPageToken || bucket.status !== "succeeded") {
      return;
    }
    manualRequestRef.current = dispatch(
      fetchBookmarkItems({ scope, contentTypes, pageSize, pageToken: bucket.nextPageToken }),
    );
  }, [
    dispatch,
    scope,
    contentTypes,
    pageSize,
    bucketMatchesCriteria,
    bucket.nextPageToken,
    bucket.status,
  ]);

  const retry = useCallback(() => {
    manualRequestRef.current?.abort?.();
    manualRequestRef.current = dispatch(fetchBookmarkItems({ scope, contentTypes, pageSize }));
  }, [dispatch, scope, contentTypes, pageSize]);

  const visibleStatus = !organizationId
    ? "idle"
    : bucketMatchesCriteria
      ? bucket.status
      : "loading";

  return {
    items: bucketMatchesCriteria ? bucket.items : [],
    status: visibleStatus,
    error: bucketMatchesCriteria ? bucket.error : null,
    hasMore: bucketMatchesCriteria && bucket.nextPageToken !== null,
    loadMore,
    retry,
  };
}
