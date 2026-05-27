export { TagChip } from '@/features/tags/components/TagChip';
export { TagPicker } from '@/features/tags/components/TagPicker';

export {
    bulkUpsertTags,
    setAssignmentsForUrn,
    applyAssignmentChange,
    removeTagLocal,
    clearTags,
    tagsReducer,
} from '@/features/tags/store/tagsSlice';
export type {
    SerializedTag,
    SerializedSavedTagFilter,
    SerializedTaggedContentItem,
    TagsState,
} from '@/features/tags/store/tagsSlice';

export {
    createSavedFilterThunk,
    createTagThunk,
    deleteSavedFilterThunk,
    deleteTagThunk,
    listContentByTagThunk,
    listSavedFiltersThunk,
    listTagsThunk,
    mergeTagsThunk,
    suggestTagsThunk,
    updateSavedFilterThunk,
    updateTagThunk,
    tagToPlain,
    savedFilterToPlain,
    taggedContentItemToPlain,
    criteriaToPlain,
    criteriaToProto,
    emptyCriteria,
    type SerializedTagFilterCriteria,
    type SerializedTagFilterIcon,
    type ListContentByTagParams,
} from '@/features/tags/store/tagsThunks';

export { tagsApi } from '@/features/tags/api/tagsApi';
export {
    tagColorClasses,
    getPaletteEntry,
    isTagPaletteSlug,
    TAG_PALETTE_SLUGS,
    type TagChipClasses,
    type TagPaletteSlug,
} from '@/features/tags/utils/colors';

export { useTagsRealtime } from '@/features/tags/hooks/useTagsRealtime';
export {
    useTagFilterState,
    isCriteriaEmpty,
    criteriaEquals,
    type UseTagFilterStateReturn,
} from '@/features/tags/hooks/useTagFilterState';
export {
    useSavedTagFilters,
    type UseSavedTagFiltersReturn,
} from '@/features/tags/hooks/useSavedTagFilters';
