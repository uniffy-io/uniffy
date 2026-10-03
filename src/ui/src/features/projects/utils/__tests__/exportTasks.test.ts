import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  FilterLogic,
  SortDirection,
  TaskExportLayout,
  TaskFilterOperator,
  TaskPseudoField,
  ViewDefinitionSchema,
} from "@uniffy/proto/projects/v1/projects_pb";
import { protoViewDefinitionToFrontend } from "@/features/projects/api/viewConverters";
import { makeTask } from "@/features/projects/utils/__tests__/taskFixtures";
import { applyFilters, buildTaskHierarchyIndex } from "@/features/projects/utils/filterTasks";
import {
  buildExportFilename,
  exportNarrowingFromDefinition,
} from "@/features/projects/utils/exportTasks";
import { emptyDefinition } from "@/features/projects/utils/viewDraft";
import type { ViewDefinition } from "@/features/projects/types/views";

const DAY = new Date(2026, 9, 1, 15, 30);

describe("buildExportFilename", () => {
  it("names one project's CSV after the org and the project", () => {
    expect(
      buildExportFilename({ orgSlug: "acme", projectSlugs: ["REL"], bundle: false, now: DAY }),
    ).toBe("acme-rel-tasks-2026-10-01.csv");
  });

  it("names several projects generically and a bundle as a zip", () => {
    expect(
      buildExportFilename({
        orgSlug: "acme",
        projectSlugs: ["REL", "MOB"],
        bundle: true,
        now: DAY,
      }),
    ).toBe("acme-projects-tasks-2026-10-01.zip");
  });

  it("keeps file names safe when slugs carry odd characters or are missing", () => {
    expect(
      buildExportFilename({ orgSlug: null, projectSlugs: ["Q3 / Ops"], bundle: false, now: DAY }),
    ).toBe("q3-ops-tasks-2026-10-01.csv");
    expect(
      buildExportFilename({ orgSlug: "acme", projectSlugs: [""], bundle: false, now: DAY }),
    ).toBe("acme-project-tasks-2026-10-01.csv");
  });
});

describe("exportNarrowingFromDefinition", () => {
  const withLayout = (layout: ViewDefinition["layout"]): ViewDefinition => ({
    ...emptyDefinition("table"),
    layout,
  });

  it("exports an outline table as an outline", () => {
    expect(exportNarrowingFromDefinition(withLayout({ type: "table", flat: false })).layout).toBe(
      TaskExportLayout.OUTLINE,
    );
  });

  it("exports a flat table and every other layout flat", () => {
    for (const layout of [
      { type: "table", flat: true },
      { type: "board", columnFieldId: "" },
      { type: "backlog" },
    ] as ViewDefinition["layout"][]) {
      expect(exportNarrowingFromDefinition(withLayout(layout)).layout).toBe(TaskExportLayout.FLAT);
    }
  });

  it("carries the view's sort", () => {
    const definition: ViewDefinition = {
      ...withLayout({ type: "table", flat: true }),
      sort: [{ field: { kind: "field", fieldId: "field_due_date" }, direction: SortDirection.ASC }],
    };
    const narrowing = exportNarrowingFromDefinition(definition);
    expect(narrowing.sort).toHaveLength(1);
    expect(narrowing.filter).toBeUndefined();
  });

  it.each(["backlog", "resources"] as const)(
    "exports only matching roots from %s while preserving OR filters",
    (type) => {
      const tasks = [
        makeTask({ id: "first", number: 1 }),
        makeTask({ id: "second", number: 2 }),
        makeTask({ id: "excluded", number: 3 }),
        makeTask({ id: "child", parentId: "first", number: 1 }),
      ];
      const definition: ViewDefinition = {
        ...withLayout({ type }),
        filter: {
          logic: FilterLogic.OR,
          nodes: [1, 2].map((number) => ({
            kind: "condition",
            condition: {
              field: { kind: "pseudo", pseudo: TaskPseudoField.NUMBER },
              operator: TaskFilterOperator.IS,
              value: { kind: "number", number },
            },
          })),
        },
      };
      const narrowing = exportNarrowingFromDefinition(definition);
      const { filter } = protoViewDefinitionToFrontend(
        create(ViewDefinitionSchema, { filter: narrowing.filter }),
      );
      const rows = applyFilters(tasks, filter, {
        hierarchy: buildTaskHierarchyIndex(tasks),
        fieldsById: new Map(),
        lookup: (id) => tasks.find((task) => task.id === id),
        currentUserId: null,
        activeSprintId: null,
        today: "2026-10-03",
        weekStartsOn: 1,
      });

      expect(rows.map((task) => task.id)).toEqual(["first", "second"]);
      expect(narrowing.layout).toBe(TaskExportLayout.FLAT);
      expect(definition.filter?.logic).toBe(FilterLogic.OR);
    },
  );
});
