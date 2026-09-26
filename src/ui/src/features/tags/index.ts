export { TagChip } from "@/features/tags/components/TagChip";
export { TagPicker, type TagPickerHandle } from "@/features/tags/components/TagPicker";

export {
  bulkUpsertTags,
  setAssignmentsForUrn,
  applyAssignmentChange,
  removeTagLocal,
  clearTags,
  tagsReducer,
} from "@/features/tags/store/tagsSlice";
export type {
  SerializedTag,
  SerializedTaggedContentItem,
  TagsState,
} from "@/features/tags/store/tagsSlice";

export {
  createTagThunk,
  deleteTagThunk,
  listContentByTagThunk,
  listTagsThunk,
  mergeTagsThunk,
  suggestTagsThunk,
  updateTagThunk,
  tagToPlain,
  taggedContentItemToPlain,
  criteriaToPlain,
  criteriaToProto,
  emptyCriteria,
  type SerializedTagFilterCriteria,
  type ListContentByTagParams,
} from "@/features/tags/store/tagsThunks";

export { tagsApi } from "@/features/tags/api/tagsApi";
export {
  tagColorClasses,
  getPaletteEntry,
  isTagPaletteSlug,
  TAG_PALETTE_SLUGS,
  type TagChipClasses,
  type TagPaletteSlug,
} from "@/features/tags/utils/colors";

export { useTagsRealtime } from "@/features/tags/hooks/useTagsRealtime";
export {
  useTagFilterState,
  isCriteriaEmpty,
  criteriaEquals,
  type UseTagFilterStateReturn,
} from "@/features/tags/hooks/useTagFilterState";
