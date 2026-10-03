import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  FilterLogic,
  TaskExportLayout,
  TaskFilterOperator,
  TaskPseudoField,
  type ExportTasksRequestSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import { frontendViewDefinitionToProto } from "@/features/projects/api/viewConverters";
import type { ViewDefinition } from "@/features/projects/types/views";

export type ExportScope = "view" | "project";

type ViewNarrowing = Pick<
  MessageInitShape<typeof ExportTasksRequestSchema>,
  "filter" | "sort" | "layout"
>;

/** Preserve each layout's task scope alongside its filter and sort. */
export function exportNarrowingFromDefinition(definition: ViewDefinition): ViewNarrowing {
  const rootsOnly = definition.layout.type === "backlog" || definition.layout.type === "resources";
  const proto = frontendViewDefinitionToProto(
    rootsOnly
      ? {
          ...definition,
          filter: {
            logic: FilterLogic.AND,
            nodes: [
              ...(definition.filter ? [{ kind: "group" as const, group: definition.filter }] : []),
              {
                kind: "condition",
                condition: {
                  field: { kind: "pseudo", pseudo: TaskPseudoField.DEPTH },
                  operator: TaskFilterOperator.IS,
                  value: { kind: "number", number: 0 },
                },
              },
            ],
          },
        }
      : definition,
  );
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
