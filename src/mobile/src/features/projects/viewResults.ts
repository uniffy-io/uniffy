import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import type { SerializedTask } from "@features/projects/projectsSerializer";
import { shapesResults } from "@features/projects/viewDefinition";

export function tasksForView(
  tasks: SerializedTask[],
  result: SerializedTask[] | undefined,
  definition: ViewDefinition,
): SerializedTask[] {
  const rows = shapesResults(definition) ? (result ?? []) : tasks;
  return definition.sort.length > 0 ? rows : [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function usesTaskOutline(definition: ViewDefinition, narrowed: boolean): boolean {
  return !narrowed && !(definition.layout.case === "table" && definition.layout.value.flat);
}
