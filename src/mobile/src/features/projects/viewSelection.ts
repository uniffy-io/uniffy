import { create } from "@bufbuild/protobuf";
import { ViewDefinitionSchema } from "@uniffy/proto/projects/v1/projects_pb";
import type { SerializedView } from "@features/projects/projectsSerializer";

const FALLBACK_VIEW: SerializedView = {
  id: "local:table",
  name: "Tasks",
  layout: "table",
  visibility: "shared",
  ownerId: "",
  sortOrder: 0,
  definition: create(ViewDefinitionSchema, { layout: { case: "table", value: {} } }),
};

export function resolveProjectView(
  views: readonly SerializedView[],
  preferredIds: readonly (string | undefined)[],
): SerializedView {
  for (const id of preferredIds) {
    const view = id ? views.find((candidate) => candidate.id === id) : undefined;
    if (view) return view;
  }
  return views[0] ?? FALLBACK_VIEW;
}
