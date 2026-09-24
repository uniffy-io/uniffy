import { describe, expect, it } from "vitest";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { Project } from "@/features/projects/types/project";
import type { ViewConfig } from "@/features/projects/types/views";
import { projectsSlice, type ProjectsState } from "@/features/projects/store/projectsSlice";
import {
  createViewThunk,
  deleteViewThunk,
  updateViewThunk,
} from "@/features/projects/store/projectsThunks";

const reducer = projectsSlice.reducer;

function view(id: string, visibility: ViewVisibility, sortOrder: number): ViewConfig {
  return {
    id,
    projectId: "proj-1",
    name: id,
    type: "table",
    definition: {
      layout: { type: "table", flat: false },
      filter: null,
      sort: [],
      groupBy: null,
      visibleFields: [],
      columnWidths: [],
      collapsedGroupKeys: [],
    },
    ownerId: "user-1",
    visibility,
    sortOrder,
    createdAt: "2026-09-17T10:00:00.000Z",
    updatedAt: "2026-09-17T10:00:00.000Z",
  };
}

const TABLE = view("view_table", ViewVisibility.SHARED, 0);
const BOARD = view("view_board", ViewVisibility.SHARED, 1);
const MINE = view("view_mine", ViewVisibility.PERSONAL, 0);

function stateWith(views: ViewConfig[], defaultViewId = "view_table"): ProjectsState {
  const initial = reducer(undefined, { type: "@@init" });
  const project = { id: "proj-1", views, defaultViewId } as unknown as Project;
  return { ...initial, projects: { "proj-1": project } };
}

function viewIds(state: ProjectsState): string[] {
  return state.projects["proj-1"].views.map((v) => v.id);
}

describe("project view reducers", () => {
  it("places a created view in server order, shared views first", () => {
    const shared = view("view_new", ViewVisibility.SHARED, 2);
    const created = reducer(
      stateWith([TABLE, BOARD, MINE]),
      createViewThunk.fulfilled(shared, "req", {
        projectId: "proj-1",
        name: "New",
        definition: shared.definition,
        visibility: ViewVisibility.SHARED,
      }),
    );

    expect(viewIds(created)).toEqual(["view_table", "view_board", "view_new", "view_mine"]);
  });

  it("moves an updated view to its new place", () => {
    const shared = { ...MINE, visibility: ViewVisibility.SHARED, sortOrder: 2 };
    const updated = reducer(
      stateWith([TABLE, BOARD, MINE]),
      updateViewThunk.fulfilled(shared, "req", {
        projectId: "proj-1",
        viewId: MINE.id,
        updates: { visibility: ViewVisibility.SHARED },
      }),
    );

    expect(viewIds(updated)).toEqual(["view_table", "view_board", "view_mine"]);
    expect(updated.projects["proj-1"].views[2].visibility).toBe(ViewVisibility.SHARED);
  });

  it("clears the project default when its view is deleted", () => {
    const deleted = reducer(
      stateWith([TABLE, BOARD]),
      deleteViewThunk.fulfilled({ projectId: "proj-1", viewId: "view_table" }, "req", {
        projectId: "proj-1",
        viewId: "view_table",
      }),
    );

    expect(viewIds(deleted)).toEqual(["view_board"]);
    expect(deleted.projects["proj-1"].defaultViewId).toBe("");
  });

  it("keeps the default when another view is deleted", () => {
    const deleted = reducer(
      stateWith([TABLE, BOARD]),
      deleteViewThunk.fulfilled({ projectId: "proj-1", viewId: "view_board" }, "req", {
        projectId: "proj-1",
        viewId: "view_board",
      }),
    );

    expect(deleted.projects["proj-1"].defaultViewId).toBe("view_table");
  });
});
