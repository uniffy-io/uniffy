import { describe, expect, it } from "vitest";
import { SortDirection, TaskExportLayout } from "@uniffy/proto/projects/v1/projects_pb";
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
});
