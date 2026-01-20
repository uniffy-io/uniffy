/**
 * Search feature exports
 */

export { searchApi } from './api/searchApi';
export { useSearch, parseSearchQuery, hasActiveFilters } from './hooks/useSearch';
export type { ParsedQuery, SearchFilters } from './hooks/useSearch';
export {
  useUrnResolution,
  clearUrnMetadataCache,
  invalidateUrnMetadataCache,
  hydrateUrnMetadataCache,
} from './hooks/useUrnResolution';
export {
  openSpotlightSearch,
  useOpenSpotlight,
} from './hooks/useSpotlightTrigger';
export { GlobalSearch } from './components/GlobalSearch';
export { SearchResultsList } from './components/SearchResultsList';
export { SpotlightSearch } from './components/SpotlightSearch';
export { FilterChip } from './components/FilterChip';
export { FilterHints, FilterHintsCompact } from './components/FilterHints';

// Query parser utilities
export {
  getTypeFilterLabel,
  getTypeFilterKeyword,
  removeTypeFilterFromQuery,
  removeTagFilterFromQuery,
  removeProjectFilterFromQuery,
  removeMyFilterFromQuery,
  FILTER_HINTS,
} from './utils/queryParser';

// Text utilities
export { stripMarkdown, stripMarkdownAndTruncate } from './utils/stripMarkdown';
