import { useState, useCallback, useEffect, useRef } from "react";
import { useAppSelector } from "@/app/hooks";
import { adminApi } from "@/features/admin/api/adminApi";
import { SUBJECT_TYPE, type Subject, type SubjectTypeFilter } from "@/components/subject/types";
import { subjectKindFromGroupKind } from "@/components/subject/utils";
import {
  cachedSuggestedPeople,
  loadSuggestedPeople,
  PEOPLE_PAGE_SIZE,
  recordPeoplePicks,
  searchPeople,
} from "@/components/subject/collaborators";

interface UseSubjectSearchOptions {
  subjectTypes?: SubjectTypeFilter;
  excludeIds?: string[];
  debounceMs?: number;
  limit?: number;
}

interface UseSubjectSearchResult {
  results: Subject[];
  /** True while the results are suggestions for an empty query rather than matches. */
  suggested: boolean;
  loading: boolean;
  error: string | null;
  search: (query: string) => void;
  clear: () => void;
  /** Tell the ranking the caller chose these people. */
  recordPicks: (userIds: string[]) => void;
}

async function searchGroups(organizationId: string, query: string, limit: number) {
  const res = await adminApi.listGroups({
    organizationId,
    search: query || undefined,
    pagination: { page: 1, pageSize: limit },
  });
  return res.groups.map((g): Subject => ({
    id: g.id,
    type: SUBJECT_TYPE.GROUP,
    name: g.name,
    memberCount: g.memberCount,
    kind: subjectKindFromGroupKind(g.kind),
    isPrivate: g.isPrivate || undefined,
  }));
}

/**
 * People and groups for pickers. An empty query lists the caller's ranked colleagues at once
 * (groups only when the picker is groups-only); one character or more searches.
 */
export function useSubjectSearch(options: UseSubjectSearchOptions = {}): UseSubjectSearchResult {
  const {
    subjectTypes = "all",
    excludeIds = [],
    debounceMs = 300,
    limit = PEOPLE_PAGE_SIZE,
  } = options;

  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const userId = useAppSelector((s) => s.auth.user?.id);
  const [query, setQuery] = useState("");
  // Tagged with the query they answer, so a mode switch never shows the other mode's rows.
  const [results, setResults] = useState<{ term: string; items: Subject[] }>({
    term: "",
    items: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const includeUsers = subjectTypes === "users" || subjectTypes === "all";
  const includeGroups = subjectTypes === "groups" || subjectTypes === "all";
  const term = query.trim();
  const excludeKey = excludeIds.join(",");

  useEffect(() => {
    if (!organizationId || !userId) return;
    const requestId = ++requestIdRef.current;
    const exclude = excludeKey ? excludeKey.split(",") : [];

    const run = async () => {
      try {
        const sources: Promise<Subject[]>[] = [];
        if (term) {
          if (includeUsers) sources.push(searchPeople(organizationId, term, exclude));
          if (includeGroups) sources.push(searchGroups(organizationId, term, limit));
        } else if (includeUsers) {
          // A list that rules out many people asks the server for the rest of the ranking.
          sources.push(
            exclude.length > 0
              ? searchPeople(organizationId, "", exclude)
              : loadSuggestedPeople(organizationId, userId),
          );
        } else if (includeGroups) {
          sources.push(searchGroups(organizationId, "", limit));
        }
        const settled = await Promise.all(sources);
        if (requestId !== requestIdRef.current) return;
        setResults({ term, items: settled.flat() });
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to search");
        setResults({ term, items: [] });
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    };

    const cached = !term && includeUsers ? cachedSuggestedPeople(organizationId, userId) : null;
    if (cached) {
      // eslint-disable-next-line react/react-compiler -- paint the last ranking at once; run() swaps in the fresh one
      setResults({ term: "", items: cached });
    } else {
      setLoading(true);
    }
    // Suggestions are cached and cheap, so only typed queries wait for the debounce.
    const timer = setTimeout(() => void run(), term ? debounceMs : 0);
    return () => clearTimeout(timer);
  }, [term, organizationId, userId, includeUsers, includeGroups, debounceMs, limit, excludeKey]);

  const excludeSet = new Set(excludeIds);
  // Typing on from one query to the next keeps the last matches; only a mode switch clears them.
  const current = (results.term === "") === (term === "");
  const filtered = current ? results.items.filter((s) => !excludeSet.has(s.id)) : [];

  const search = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const clear = useCallback(() => {
    setQuery("");
  }, []);

  const recordPicks = useCallback(
    (userIds: string[]) => {
      if (organizationId) recordPeoplePicks(organizationId, userIds);
    },
    [organizationId],
  );

  return {
    results: filtered,
    suggested: !term,
    loading: loading || !current,
    error,
    search,
    clear,
    recordPicks,
  };
}
