import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { onMentionStateChange } from "@/components/mention/mentionStateEmitter";
import { parseUrn, UrnType } from "@/shared/utils/urn";
import {
  applyAssignmentChange,
  bulkUpsertTags,
  patchTag,
  removeTagLocal,
} from "@/features/tags/store/tagsSlice";
import type { SerializedTag } from "@/features/tags/store/tagsThunks";
import { MentionAvailability, type MentionLiveState } from "@/components/mention/types";

function buildTagFromState(
  urn: string,
  tagId: string,
  state: Partial<MentionLiveState>,
): SerializedTag | null {
  if (!state.tagSlug && !state.title) return null;
  return {
    id: tagId,
    name: state.title ?? "",
    slug: state.tagSlug ?? "",
    color: state.tagColor ?? "",
    description: state.description ?? "",
    createdBy: "",
    usageCount: state.tagUsageCount ?? 0,
    urn,
  };
}

function buildTagPatch(state: Partial<MentionLiveState>): Partial<SerializedTag> {
  const patch: Partial<SerializedTag> = {};
  if (state.title !== undefined) patch.name = state.title;
  if (state.tagSlug !== undefined) patch.slug = state.tagSlug;
  if (state.tagColor !== undefined) patch.color = state.tagColor;
  if (state.description !== undefined) patch.description = state.description;
  if (state.tagUsageCount !== undefined) patch.usageCount = state.tagUsageCount;
  return patch;
}

export function useTagsRealtime(): void {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId);
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);

  useEffect(() => {
    if (!organizationId || !isAuthenticated) return undefined;

    const unsubscribe = onMentionStateChange((urn, changes) => {
      const parsed = parseUrn(urn);
      if (!parsed.isValid) return;

      if (parsed.type === UrnType.TAG) {
        if (changes.availability === MentionAvailability.Deleted) {
          dispatch(removeTagLocal(parsed.id));
          return;
        }
        const tag = buildTagFromState(urn, parsed.id, changes);
        if (tag) {
          dispatch(bulkUpsertTags([tag]));
          return;
        }
        const patch = buildTagPatch(changes);
        if (Object.keys(patch).length > 0) {
          dispatch(patchTag({ id: parsed.id, ...patch }));
        }
        return;
      }

      const added = changes.tagAssignmentsAdded;
      const removed = changes.tagAssignmentsRemoved;
      if (added !== undefined || removed !== undefined) {
        dispatch(
          applyAssignmentChange({
            urn,
            added: added ?? [],
            removed: removed ?? [],
          }),
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, organizationId, isAuthenticated]);
}
