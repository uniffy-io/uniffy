import { useState, useEffect, useRef } from "react";
import { useAuth } from "@core/providers/AuthContext";
import { searchApi } from "@features/search/searchApi";
import { SearchResultType } from "@uniffy/proto/search/v1/search_pb";
import { searchResultToPlain } from "@features/search/searchSerializer";
import type { SerializedSearchResult } from "@features/search/searchSerializer";

const DEBOUNCE_MS = 200;
// People-first, matching the web chat popup: users, agents, and teams
// (a team mention notifies its members) sit above content unconditionally,
// and the people query matches names only so a shared email domain does
// not pull in the whole org.
const PEOPLE_TYPES = [SearchResultType.USER, SearchResultType.AGENT, SearchResultType.TEAM];
const PEOPLE_LIMIT = 6;
const CONTENT_LIMIT = 6;

export type MentionToken = { query: string; start: number; end: number };

/** Active `@token` the cursor sits in: `@` at start or after whitespace, no spaces inside.
 *  `query` is the text typed so far (up to the caret); `end` runs to the end of
 *  the word, so replacing `start..end` never strands a tail after a mid-token pick. */
export function findMentionToken(text: string, cursor: number): MentionToken | null {
  const caret = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, caret);
  const atIndex = before.lastIndexOf("@");
  if (atIndex === -1) return null;
  if (atIndex > 0 && !/\s/.test(before[atIndex - 1])) return null;
  const query = before.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  let end = caret;
  while (end < text.length && !/\s/.test(text[end])) end += 1;
  return { query, start: atIndex, end };
}

export function useMentionTypeahead(text: string, cursor: number) {
  const { organizationId } = useAuth();
  const [results, setResults] = useState<SerializedSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const token = findMentionToken(text, cursor);
  const tokenQuery = token ? token.query : null;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (tokenQuery === null || !organizationId) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const seq = ++requestSeq.current;

    debounceRef.current = setTimeout(async () => {
      try {
        // A bare `@` lists people by recency (filter-only search); content
        // only joins once there is something to match it against.
        const peopleCall = searchApi.search({
          organizationId,
          query: tokenQuery,
          typeFilters: PEOPLE_TYPES,
          nameMatchesOnly: true,
          limit: PEOPLE_LIMIT,
        });
        const contentCall = tokenQuery.trim()
          ? searchApi.search({ organizationId, query: tokenQuery, limit: CONTENT_LIMIT })
          : Promise.resolve(null);

        const [people, content] = await Promise.all([peopleCall, contentCall]);
        if (seq !== requestSeq.current) return;

        const peopleItems = people.items.map(searchResultToPlain);
        const peopleUrns = new Set(peopleItems.map((r) => r.urn));
        // People carry no navigation domain, so they must survive the
        // domain filter: the content query is what finds them by email,
        // job title, or username when the name-only query misses.
        const contentItems = (content?.items ?? [])
          .map(searchResultToPlain)
          .filter(
            (r) => !peopleUrns.has(r.urn) && (r.domain !== null || PEOPLE_TYPES.includes(r.type)),
          );

        setResults([...peopleItems, ...contentItems]);
      } catch {
        if (seq === requestSeq.current) setResults([]);
      } finally {
        if (seq === requestSeq.current) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [tokenQuery, organizationId]);

  return { token, results, isLoading };
}
