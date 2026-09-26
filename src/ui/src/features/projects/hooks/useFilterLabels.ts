import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { useTagsByIds } from "@/features/tags/store/selectors";
import { selectTasksMap } from "@/features/projects/store/projectsSlice";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import type { FieldDefinition } from "@/features/projects/types";
import type { ViewFilterGroup } from "@/features/projects/types/views";
import type { FilterLabels } from "@/features/projects/utils/filterTree";
import { TASK_TYPE_MAP } from "@/features/projects/utils/taskTypes";
import { fieldKindOf, fieldRefLabel } from "@/features/projects/utils/viewFields";
import { formatDateShort } from "@/shared/utils/dateFormatting";

function idsOfKinds(
  filter: ViewFilterGroup | null,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
  kinds: ReadonlySet<string>,
): string[] {
  const ids = new Set<string>();
  const visit = (group: ViewFilterGroup) => {
    for (const node of group.nodes) {
      if (node.kind === "group") {
        visit(node.group);
        continue;
      }
      const kind = fieldKindOf(node.condition.field, fieldsById);
      if (kind && kinds.has(kind) && node.condition.value?.kind === "ids") {
        for (const id of node.condition.value.ids.ids) ids.add(id);
      }
    }
  };
  if (filter) visit(filter);
  return [...ids].sort();
}

const PERSON_KINDS: ReadonlySet<string> = new Set(["person", "single_person"]);
const TAG_KINDS: ReadonlySet<string> = new Set(["tags"]);

/** Names for every value a filter picks, so its conditions read as sentences. */
export function useFilterLabels(
  projectId: string,
  filter: ViewFilterGroup | null,
  fieldsById: ReadonlyMap<string, FieldDefinition>,
): FilterLabels {
  const personIds = useMemo(
    () => idsOfKinds(filter, fieldsById, PERSON_KINDS),
    [filter, fieldsById],
  );
  const tagIds = useMemo(() => idsOfKinds(filter, fieldsById, TAG_KINDS), [filter, fieldsById]);
  const { subjects } = useSubjectResolver(personIds);
  const tags = useTagsByIds(tagIds);
  const sprints = useAppSelector(selectSprintsForProject(projectId));
  const tasks = useAppSelector(selectTasksMap);

  return useMemo<FilterLabels>(() => {
    const names = new Map<string, string>([
      ...subjects.map((subject): [string, string] => [subject.id, subject.name]),
      ...tags.map((tag): [string, string] => [tag.id, tag.name]),
      ...sprints.map((sprint): [string, string] => [sprint.id, sprint.name]),
    ]);
    return {
      field: (ref) => fieldRefLabel(ref, fieldsById),
      value: (ref, kind, id) => {
        if (kind === "single_select" || kind === "multi_select") {
          const field = ref.kind === "field" ? fieldsById.get(ref.fieldId) : undefined;
          return (
            field?.config.options?.find((option) => option.id === id)?.label ?? "a deleted option"
          );
        }
        if (kind === "task_type") return TASK_TYPE_MAP.get(id)?.label ?? id;
        if (kind === "task_ref" || kind === "task_ref_set" || kind === "epic") {
          return tasks[id]?.title ?? "a task";
        }
        return (
          names.get(id) ?? (kind === "tags" ? "a tag" : kind === "sprint" ? "a sprint" : "someone")
        );
      },
      date: formatDateShort,
    };
  }, [subjects, tags, sprints, tasks, fieldsById]);
}
