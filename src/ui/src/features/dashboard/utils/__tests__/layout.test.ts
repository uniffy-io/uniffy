import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, type DashboardCatalog } from "@/features/dashboard/types";
import {
  describeFilters,
  fullLayout,
  isTaskListWidget,
  metricKey,
  moveWidget,
  parseDashboardProposal,
  parseLegacyLayout,
} from "@/features/dashboard/utils/layout";

const catalog: DashboardCatalog = {
  widgets: [
    {
      id: "my-tasks",
      label: "My tasks",
      description: "",
      filterable: false,
      defaultSize: "expanded",
    },
    {
      id: "overdue-tasks",
      label: "Overdue",
      description: "",
      filterable: true,
      defaultSize: "compact",
    },
    {
      id: "workload",
      label: "Workload",
      description: "",
      filterable: true,
      defaultSize: "expanded",
    },
  ],
  presets: [],
  defaultDefinition: { widgets: [], preset: "", name: "" },
};

const widget = (id: string, visible = true) => ({
  id,
  visible,
  size: "expanded" as const,
  filters: { ...DEFAULT_FILTERS },
  unsupportedFilters: [],
});

describe("fullLayout", () => {
  it("keeps saved order, appends the rest hidden and drops retired widgets", () => {
    const layout = fullLayout(
      {
        widgets: [widget("workload"), widget("retired"), widget("my-tasks")],
        preset: "",
        name: "",
      },
      catalog,
    );
    expect(layout.map((w) => [w.id, w.visible])).toEqual([
      ["workload", true],
      ["my-tasks", true],
      ["overdue-tasks", false],
    ]);
    expect(layout[2].size).toBe("compact");
  });
});

describe("moveWidget", () => {
  it("moves within bounds and ignores out-of-range moves", () => {
    const list = [widget("a"), widget("b"), widget("c")];
    expect(moveWidget(list, 0, 2).map((w) => w.id)).toEqual(["b", "c", "a"]);
    expect(moveWidget(list, 0, -1)).toBe(list);
    expect(moveWidget(list, 2, 3)).toBe(list);
  });
});

describe("parseLegacyLayout", () => {
  it("reads the browser layout older versions saved", () => {
    const parsed = parseLegacyLayout(
      JSON.stringify([
        { id: "my-tasks", visible: false, size: "compact" },
        { id: "workload" },
        "junk",
      ]),
    );
    expect(parsed?.widgets.map((w) => [w.id, w.visible, w.size])).toEqual([
      ["my-tasks", false, "compact"],
      ["workload", true, "expanded"],
    ]);
    expect(parseLegacyLayout("not json")).toBeNull();
    expect(parseLegacyLayout(null)).toBeNull();
  });
});

describe("parseDashboardProposal", () => {
  it("reads the agent tool payload and rejects anything else", () => {
    const meta = JSON.stringify({
      kind: "dashboard_proposal",
      organization_id: "org-1",
      description: "QA view",
      definition: {
        widgets: [
          {
            id: "overdue-tasks",
            size: "compact",
            filters: { projects: "selected", project_ids: ["p1"], people: "me", sprint: "active" },
          },
        ],
      },
    });
    const proposal = parseDashboardProposal(meta);
    expect(proposal?.organizationId).toBe("org-1");
    // Without a stored name the description titles the dashboard.
    expect(proposal?.definition.name).toBe("QA view");
    expect(proposal?.definition.widgets[0].filters).toEqual({
      projects: "selected",
      projectIds: ["p1"],
      people: "me",
      sprint: "active",
    });
    expect(parseDashboardProposal(JSON.stringify({ kind: "image_generation" }))).toBeNull();
    expect(parseDashboardProposal("{")).toBeNull();
  });
});

describe("metricKey and describeFilters", () => {
  it("shares a cache entry for equal filters regardless of project order", () => {
    const a = { ...DEFAULT_FILTERS, projects: "selected" as const, projectIds: ["b", "a"] };
    const b = { ...DEFAULT_FILTERS, projects: "selected" as const, projectIds: ["a", "b"] };
    expect(metricKey("workload", a)).toBe(metricKey("workload", b));
    expect(metricKey("workload", a)).not.toBe(metricKey("overdue-tasks", a));
  });

  it("names only the filters that narrow the widget", () => {
    expect(describeFilters(DEFAULT_FILTERS)).toBe("");
    expect(
      describeFilters({ ...DEFAULT_FILTERS, projects: "my_projects", people: "my_teams" }),
    ).toBe("My projects · My teams");
  });

  it("knows which widgets list tasks", () => {
    expect(isTaskListWidget("review-queue")).toBe(true);
    expect(isTaskListWidget("workload")).toBe(false);
  });
});
