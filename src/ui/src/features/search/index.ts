/**
 * Search feature exports
 */

export { searchApi } from './api/searchApi';
export { useSearch } from './hooks/useSearch';
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
