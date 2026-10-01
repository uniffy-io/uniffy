import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  TaskExportLayout,
  type ExportTasksRequestSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import { frontendViewDefinitionToProto } from "@/features/projects/api/viewConverters";
import type { ViewDefinition } from "@/features/projects/types/views";

export type ExportScope = "view" | "project";

type ViewNarrowing = Pick<
  MessageInitShape<typeof ExportTasksRequestSchema>,
  "filter" | "sort" | "layout"
>;

/**
 * The filter, sort and row shape the view renders, so the export holds what the table shows.
 * The outline table filters top-level tasks and nests every child under them; every other
 * layout lists matching tasks flat.
 */
export function exportNarrowingFromDefinition(definition: ViewDefinition): ViewNarrowing {
  const proto = frontendViewDefinitionToProto(definition);
  const outline = definition.layout.type === "table" && !definition.layout.flat;
  return {
    filter: proto.filter,
    sort: proto.sort,
    layout: outline ? TaskExportLayout.OUTLINE : TaskExportLayout.FLAT,
  };
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isoDay(now: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `{org}-{project}-tasks-{day}.csv`, `{org}-projects-tasks-{day}.csv` for several; `.zip` bundles. */
export function buildExportFilename({
  orgSlug,
  projectSlugs,
  bundle,
  now = new Date(),
}: {
  orgSlug: string | null;
  projectSlugs: string[];
  bundle: boolean;
  now?: Date;
}): string {
  const subject = projectSlugs.length === 1 ? slugPart(projectSlugs[0]) || "project" : "projects";
  const parts = [slugPart(orgSlug ?? ""), subject, "tasks", isoDay(now)].filter(Boolean);
  return `${parts.join("-")}.${bundle ? "zip" : "csv"}`;
}
