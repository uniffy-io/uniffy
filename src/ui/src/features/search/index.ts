/**
 * Search feature exports
 */

export { searchApi } from '@/features/search/api/searchApi';
export { useSearch, parseSearchQuery, hasActiveFilters } from '@/features/search/hooks/useSearch';
export type { ParsedQuery, SearchFilters } from '@/features/search/hooks/useSearch';
export {
  useUrnResolution,
  clearUrnMetadataCache,
  invalidateUrnMetadataCache,
  hydrateUrnMetadataCache,
} from '@/features/search/hooks/useUrnResolution';
export {
  openSpotlightSearch,
  useOpenSpotlight,
} from '@/features/search/hooks/useSpotlightTrigger';
export { GlobalSearch } from '@/features/search/components/GlobalSearch';
export { SearchResultsList } from '@/features/search/components/SearchResultsList';
export { SpotlightSearch } from '@/features/search/components/SpotlightSearch';
export { FilterChip } from '@/features/search/components/FilterChip';
export { FilterHints, FilterHintsCompact } from '@/features/search/components/FilterHints';

// Query parser utilities
export {
  getTypeFilterLabel,
  getTypeFilterKeyword,
  removeTypeFilterFromQuery,
  removeTagFilterFromQuery,
  removeProjectFilterFromQuery,
  removeMyFilterFromQuery,
  FILTER_HINTS,
} from '@/features/search/utils/queryParser';

// Text utilities
export { stripMarkdown, stripMarkdownAndTruncate } from '@/features/search/utils/stripMarkdown';
