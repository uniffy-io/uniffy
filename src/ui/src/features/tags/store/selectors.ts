import { shallowEqual } from "react-redux";

import { useAppSelector } from "@/app/hooks";
import type { RootState } from "@/app/store";
import type { SerializedTag } from "@/features/tags/store/tagsThunks";

const EMPTY_TAGS: readonly SerializedTag[] = Object.freeze([]);

/** Returns a stable empty array reference when `ids` is empty so subscribers don't re-render on unrelated tag activity. */
export function useTagsByIds(ids: readonly string[]): readonly SerializedTag[] {
  const empty = ids.length === 0;
  return useAppSelector((state: RootState): readonly SerializedTag[] => {
    if (empty) return EMPTY_TAGS;
    const out: SerializedTag[] = [];
    for (const id of ids) {
      const tag = state.tags.byId[id];
      if (tag) out.push(tag);
    }
    return out;
  }, shallowEqual);
}

export function useTagById(id: string | null | undefined): SerializedTag | undefined {
  return useAppSelector((state: RootState) => (id ? state.tags.byId[id] : undefined));
}
