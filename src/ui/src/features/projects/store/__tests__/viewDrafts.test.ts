import { describe, expect, it } from "vitest";
import { combineReducers, configureStore } from "@reduxjs/toolkit";
import {
  FilterLogic,
  RoadmapZoom,
  SortDirection,
  TaskFilterOperator,
  TaskPseudoField,
  ViewVisibility,
} from "@uniffy/proto/projects/v1/projects_pb";
import type { RootState } from "@/app/store";
import { AUTH_ACTION_TYPES } from "@/features/auth/store/authActions";
import type { Project } from "@/features/projects/types/project";
import type { ViewConfig, ViewDefinition, ViewType } from "@/features/projects/types/views";
import { projectsReducer } from "@/features/projects/store/projectsSlice";
import {
  openView,
  projectsUiReducer,
  setSearchQuery,
} from "@/features/projects/store/projectsUiSlice";
import {
  selectActiveDefinition,
  selectActiveView,
  selectDirtyViewIds,
  selectIsActiveViewDirty,
} from "@/features/projects/store/viewSelectors";
import {
  setDraftColumnWidth,
  setDraftFilter,
  setDraftGroupBy,
  setDraftLayout,
  setDraftSort,
  toggleDraftCollapsedGroup,
} from "@/features/projects/store/viewDraftThunks";
import {
  persistedProjectsUi,
  rehydrateProjectsUi,
} from "@/features/projects/store/projectsUiPersist";
import { emptyDefinition, setQuickFilter } from "@/features/projects/utils/viewDraft";
import { fieldRef, pseudoRef } from "@/features/projects/utils/viewFields";

function view(id: string, type: ViewType, definition: ViewDefinition = emptyDefinition(type)) {
  return {
    id,
    projectId: "",
    name: id,
    type,
    definition,
    ownerId: "user-1",
    visibility: ViewVisibility.SHARED,
    sortOrder: 0,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  } satisfies ViewConfig;
}

function project(id: string, views: ViewConfig[], defaultViewId: string): Project {
  return {
    id,
    views: views.map((v) => ({ ...v, projectId: id })),
    defaultViewId,
    fieldDefinitions: [],
  } as unknown as Project;
}

const SORTED_TABLE: ViewDefinition = {
  ...emptyDefinition("table"),
  sort: [{ field: fieldRef("field_status"), direction: SortDirection.ASC }],
};

function makeStore() {
  const reducer = combineReducers({ projects: projectsReducer, projectsUi: projectsUiReducer });
  const initial = reducer(undefined, { type: "@@init" });
  const preloaded = {
    ...initial,
    projects: {
      ...initial.projects,
      projects: {
        a: project(
          "a",
          [view("view_table", "table", SORTED_TABLE), view("view_board", "board")],
          "view_board",
        ),
        b: project("b", [view("view_table", "table"), view("view_roadmap", "roadmap")], ""),
      },
    },
  };
  const store = configureStore({ reducer, preloadedState: preloaded });
  return {
    dispatch: store.dispatch as (action: unknown) => unknown,
    state: () => store.getState() as unknown as RootState,
  };
}

describe("active view", () => {
  it("opens the project default, then the first view when there is none", () => {
    const { state } = makeStore();
    expect(selectActiveView("a")(state())?.id).toBe("view_board");
    expect(selectActiveView("b")(state())?.id).toBe("view_table");
  });

  it("remembers the last opened view per project and forgets one that is gone", () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    dispatch(openView({ projectId: "b", viewId: "view_missing" }));
    expect(selectActiveView("a")(state())?.id).toBe("view_table");
    expect(selectActiveView("b")(state())?.id).toBe("view_table");
  });
});

describe("view drafts", () => {
  it("marks a view dirty on an edit and clean again once it matches the saved definition", () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    expect(selectIsActiveViewDirty("a")(state())).toBe(false);

    dispatch(setDraftSort("a", []));
    expect(selectIsActiveViewDirty("a")(state())).toBe(true);
    expect(selectActiveDefinition("a")(state()).sort).toEqual([]);

    dispatch(setDraftSort("a", SORTED_TABLE.sort));
    expect(selectIsActiveViewDirty("a")(state())).toBe(false);
    expect(state().projectsUi.viewDrafts).toEqual({});
  });

  it("keeps each view's own widths, sort, grouping and collapsed groups", () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    dispatch(setDraftColumnWidth("a", fieldRef("field_title"), 420));
    dispatch(
      setDraftGroupBy("a", {
        field: pseudoRef(TaskPseudoField.SPRINT),
        direction: SortDirection.ASC,
        hideEmpty: false,
      }),
    );
    dispatch(toggleDraftCollapsedGroup("a", "sprint-1"));

    dispatch(openView({ projectId: "a", viewId: "view_board" }));
    expect(selectActiveDefinition("a")(state())).toEqual(emptyDefinition("board"));
    dispatch(toggleDraftCollapsedGroup("a", "epic-9"));

    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    const table = selectActiveDefinition("a")(state());
    expect(table.columnWidths).toEqual([{ field: fieldRef("field_title"), width: 420 }]);
    expect(table.sort).toEqual(SORTED_TABLE.sort);
    expect(table.collapsedGroupKeys).toEqual(["sprint-1"]);
    expect(selectDirtyViewIds("a")(state())).toEqual(["view_table", "view_board"]);
  });

  it("keeps a filter set in one project out of another", () => {
    const { dispatch, state } = makeStore();
    dispatch(setDraftFilter("a", setQuickFilter(null, "sprint", ["sprint-1"])));
    expect(selectActiveDefinition("a")(state()).filter?.nodes).toHaveLength(1);
    expect(selectActiveDefinition("b")(state()).filter).toBeNull();
    expect(selectIsActiveViewDirty("b")(state())).toBe(false);
  });

  it("never marks a view dirty for a search", () => {
    const { dispatch, state } = makeStore();
    dispatch(setSearchQuery("login"));
    expect(selectIsActiveViewDirty("a")(state())).toBe(false);
  });

  it("clamps widths to what a save accepts and ignores a layout of another type", () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    dispatch(setDraftColumnWidth("a", fieldRef("field_title"), 5));
    dispatch(setDraftLayout("a", { type: "roadmap", zoom: RoadmapZoom.DAY }));
    const definition = selectActiveDefinition("a")(state());
    expect(definition.columnWidths[0].width).toBe(40);
    expect(definition.layout.type).toBe("table");
  });

  it("drops an empty filter instead of storing an empty group", () => {
    const { dispatch, state } = makeStore();
    dispatch(setDraftFilter("a", { logic: FilterLogic.AND, nodes: [] }));
    expect(selectIsActiveViewDirty("a")(state())).toBe(false);
  });

  it("clears drafts and open views on logout", () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    dispatch(setDraftSort("a", []));
    dispatch({ type: AUTH_ACTION_TYPES.LOGOUT });
    expect(state().projectsUi.viewDrafts).toEqual({});
    expect(state().projectsUi.activeViewIds).toEqual({});
  });
});

describe("draft persistence", () => {
  it("restores drafts and open views after a reload and drops transient state", () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "a", viewId: "view_table" }));
    dispatch(setDraftFilter("a", setQuickFilter(null, "taskType", ["bug"])));
    dispatch(setSearchQuery("crash"));

    const stored = JSON.parse(JSON.stringify(persistedProjectsUi(state().projectsUi)));
    expect(stored.searchQuery).toBeUndefined();

    const restored = rehydrateProjectsUi(stored);
    expect(restored.activeViewIds).toEqual({ a: "view_table" });
    expect(restored.viewDrafts.a.view_table.filter?.nodes[0]).toMatchObject({
      kind: "condition",
      condition: { operator: TaskFilterOperator.IS },
    });
    expect(restored.searchQuery).toBe("");
  });

  it("starts clean from state persisted before views held drafts", () => {
    const restored = rehydrateProjectsUi({
      viewMode: "board",
      hiddenColumns: { a: ["field_status"] },
      isSidebarOpen: false,
    });
    expect(restored.viewDrafts).toEqual({});
    expect(restored.isSidebarOpen).toBe(false);
    expect("viewMode" in restored).toBe(false);
    expect("hiddenColumns" in restored).toBe(false);
  });
});
