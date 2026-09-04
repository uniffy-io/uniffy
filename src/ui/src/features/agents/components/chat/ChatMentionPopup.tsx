import { useRef, useEffect, useCallback, useMemo } from "react";
import { X, At, Megaphone } from "@phosphor-icons/react";
import { SearchResultsList, useSearch } from "@/features/search";
import { FilterChip } from "@/features/search/components/FilterChip";
import { FilterHints } from "@/features/search/components/FilterHints";
import {
  getTypeFilterLabel,
  removeTypeFilterFromQuery,
  removeTagFilterFromQuery,
  removeMyFilterFromQuery,
  removeProjectFilterFromQuery,
} from "@/features/search/utils/queryParser";
import { SearchResultType, type SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";

// An @-mention is a people gesture first: users, agents, and teams (mentioning
// one notifies its members) sit above content unconditionally. A single
// re-ranked query cannot deliver that - an org where everyone's email matches
// the query fills the whole page with users and pushes exact-name agents out -
// so the popup runs a dedicated people query (relevance-ordered within the
// group, capped) and prepends it to the content results.
const MENTION_PEOPLE_TYPES: SearchResultType[] = [
  SearchResultType.USER,
  SearchResultType.AGENT,
  SearchResultType.TEAM,
];
const MENTION_PEOPLE_LIMIT = 8;
// nameMatchesOnly keeps the shared email domain (and other non-name text) from
// matching every member of the org.
const MENTION_PEOPLE_SEARCH_OPTIONS = {
  typeFilters: MENTION_PEOPLE_TYPES,
  nameMatchesOnly: true,
  limit: MENTION_PEOPLE_LIMIT,
};

interface ChatMentionPopupProps {
  initialQuery: string;
  onSelect: (result: SearchResultItem) => void;
  onClose: () => void;
  onQuerySync?: (query: string) => void;
  /** Non-search entries (broadcast mentions) prepended when the query prefix-matches. */
  staticEntries?: SearchResultItem[];
}

export function ChatMentionPopup({
  initialQuery,
  onSelect,
  onClose,
  onQuerySync,
  staticEntries,
}: ChatMentionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    query: searchQuery,
    setQuery: setContentQuery,
    results,
    isLoading: contentLoading,
    clearResults: clearContentResults,
    parsedQuery,
    hasFilters,
  } = useSearch();

  const {
    setQuery: setPeopleQuery,
    results: peopleResults,
    isLoading: peopleLoading,
    clearResults: clearPeopleResults,
  } = useSearch(MENTION_PEOPLE_SEARCH_OPTIONS);

  const setQuery = useCallback(
    (q: string) => {
      setContentQuery(q);
      setPeopleQuery(q);
    },
    [setContentQuery, setPeopleQuery],
  );

  const clearResults = useCallback(() => {
    clearContentResults();
    clearPeopleResults();
  }, [clearContentResults, clearPeopleResults]);

  const isLoading = contentLoading || peopleLoading;

  // An explicitly typed type filter (note:, file:, ...) is the user narrowing
  // on purpose; the people group and static entries step aside for it.
  const orderedResults = useMemo(() => {
    if (parsedQuery.filters.types.length > 0) return results;
    const q = searchQuery.trim().toLowerCase().replace(/^@/, "");
    const staticMatches = q
      ? (staticEntries ?? []).filter((entry) =>
          entry.title.toLowerCase().replace(/^@/, "").startsWith(q),
        )
      : [];
    const peopleUrns = new Set(peopleResults.map((r) => r.urn));
    return [...staticMatches, ...peopleResults, ...results.filter((r) => !peopleUrns.has(r.urn))];
  }, [parsedQuery.filters.types.length, peopleResults, results, searchQuery, staticEntries]);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- seed once on mount

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newQuery = e.target.value;
      setQuery(newQuery);
      onQuerySync?.(newQuery);
    },
    [setQuery, onQuerySync],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      // ArrowUp/Down and Enter are handled by SearchResultsList's document listener
    },
    [onClose],
  );

  const handleClear = useCallback(() => {
    setQuery("");
    onQuerySync?.("");
    clearResults();
    inputRef.current?.focus();
  }, [setQuery, onQuerySync, clearResults]);

  const handleRemoveTypeFilter = useCallback(
    (type: number) => {
      const newQuery = removeTypeFilterFromQuery(searchQuery, type);
      setQuery(newQuery);
      onQuerySync?.(newQuery);
    },
    [searchQuery, setQuery, onQuerySync],
  );

  const handleRemoveTagFilter = useCallback(
    (tag: string) => {
      const newQuery = removeTagFilterFromQuery(searchQuery, tag);
      setQuery(newQuery);
      onQuerySync?.(newQuery);
    },
    [searchQuery, setQuery, onQuerySync],
  );

  const handleRemoveProjectFilter = useCallback(
    (project: string) => {
      const newQuery = removeProjectFilterFromQuery(searchQuery, project);
      setQuery(newQuery);
      onQuerySync?.(newQuery);
    },
    [searchQuery, setQuery, onQuerySync],
  );

  const handleRemoveMyFilter = useCallback(() => {
    const newQuery = removeMyFilterFromQuery(searchQuery);
    setQuery(newQuery);
    onQuerySync?.(newQuery);
  }, [searchQuery, setQuery, onQuerySync]);

  const handleFilterHintClick = useCallback(
    (filter: string) => {
      const newQuery = filter + " ";
      setQuery(newQuery);
      onQuerySync?.(newQuery);
      inputRef.current?.focus();
    },
    [setQuery, onQuerySync],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[999] animate-in fade-in-0 duration-150" />

      <div
        className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]"
        data-testid="chat-mention-popup"
      >
        <div
          ref={popupRef}
          className="w-full max-w-2xl mx-4 animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200"
        >
          <div
            className={cn(popoverShellClass, "rounded-2xl ring-1 ring-primary/40 overflow-hidden")}
          >
            <div className="relative flex items-center border-b border-border/50">
              <div className="absolute left-4 flex items-center gap-1">
                <At size={20} weight="bold" className="text-primary" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={handleInputChange}
                onKeyDown={handleInputKeyDown}
                placeholder="Search to mention..."
                className={cn(
                  "w-full h-14 bg-transparent pl-12 pr-20 text-lg",
                  "placeholder:text-subtle-foreground",
                  "focus:outline-none",
                )}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-testid="chat-mention-popup-input"
              />
              <div className="absolute right-4 flex items-center gap-2">
                {searchQuery && (
                  <button
                    onClick={handleClear}
                    className="p-1 rounded-md hover:bg-muted transition-colors"
                  >
                    <X size={16} weight="bold" className="text-muted-foreground" />
                  </button>
                )}
                <kbd className="hidden sm:inline-flex px-2 py-1 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground font-mono">
                  esc
                </kbd>
              </div>
            </div>

            {hasFilters && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/50 bg-muted/30">
                {parsedQuery.filters.types.map((type) => (
                  <FilterChip
                    key={`type-${type}`}
                    label={getTypeFilterLabel(type)}
                    onRemove={() => handleRemoveTypeFilter(type)}
                  />
                ))}
                {parsedQuery.filters.tags.map((tag) => (
                  <FilterChip
                    key={`tag-${tag}`}
                    label={`tag:${tag}`}
                    onRemove={() => handleRemoveTagFilter(tag)}
                  />
                ))}
                {parsedQuery.filters.projects.map((project) => (
                  <FilterChip
                    key={`project-${project}`}
                    label={`project:${project}`}
                    onRemove={() => handleRemoveProjectFilter(project)}
                  />
                ))}
                {parsedQuery.filters.myContentOnly && (
                  <FilterChip label="My content" onRemove={handleRemoveMyFilter} />
                )}
              </div>
            )}

            {searchQuery.trim() || isLoading || hasFilters ? (
              <SearchResultsList
                results={orderedResults}
                isLoading={isLoading}
                query={searchQuery}
                onSelect={onSelect}
                onClose={onClose}
                className="border-0 shadow-none ring-0 rounded-none max-h-[60vh]"
                showHeader={false}
                showFooter={true}
                emptyMessage="No content found"
              />
            ) : (
              <div className="pb-2">
                {staticEntries && staticEntries.length > 0 && (
                  <div className="px-4 pt-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground mb-2">
                      Notify channel
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {staticEntries.map((entry) => (
                        <button
                          key={entry.urn}
                          onClick={() => onSelect(entry)}
                          title={entry.description}
                          className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
                        >
                          <Megaphone size={14} weight="duotone" className="text-primary" />
                          <span className="text-sm font-medium text-primary">{entry.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="py-8 px-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Type to search for content to mention
                  </p>
                  <p className="text-xs text-subtle-foreground mt-2 mb-4">
                    Search for notes, files, users, and more
                  </p>
                  <FilterHints onHintClick={handleFilterHintClick} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
