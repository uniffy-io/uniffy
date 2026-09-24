import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SortDirection, ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { projectsApi } from "@/features/projects/api/projectsApi";
import { projectsReducer } from "@/features/projects/store/projectsSlice";
import { openView, projectsUiReducer } from "@/features/projects/store/projectsUiSlice";
import {
  createViewOfType,
  duplicateView,
  nextViewName,
  removeView,
  reorderedGroupIds,
  saveViewAs,
  saveViewDraft,
} from "@/features/projects/store/viewActions";
import { setDraftSort } from "@/features/projects/store/viewDraftThunks";
import { selectActiveView, selectIsActiveViewDirty } from "@/features/projects/store/viewSelectors";
import type { Project } from "@/features/projects/types/project";
import type { ViewConfig, ViewDefinition, ViewType } from "@/features/projects/types/views";
import { emptyDefinition } from "@/features/projects/utils/viewDraft";
import { fieldRef } from "@/features/projects/utils/viewFields";

vi.mock("@/features/projects/api/projectsApi", () => ({
  projectsApi: { createView: vi.fn(), updateView: vi.fn(), deleteView: vi.fn() },
}));

function view(
  id: string,
  type: ViewType,
  visibility = ViewVisibility.SHARED,
  sortOrder = 0,
  definition: ViewDefinition = emptyDefinition(type),
): ViewConfig {
  return {
    id,
    projectId: "p",
    name: id,
    type,
    definition,
    ownerId: "user-1",
    visibility,
    sortOrder,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };
}

const TABLE = view("view_table", "table");
const BOARD = view("view_board", "board", ViewVisibility.SHARED, 1);
const MINE = view("mine", "table", ViewVisibility.PERSONAL);
const SORT = [{ field: fieldRef("field_status"), direction: SortDirection.ASC }];

function makeStore() {
  const reducer = combineReducers({
    projects: projectsReducer,
    projectsUi: projectsUiReducer,
    auth: (state: { currentOrganizationId: string } = { currentOrganizationId: "org" }) => state,
  });
  const initial = reducer(undefined, { type: "@@init" });
  const store = configureStore({
    reducer,
    preloadedState: {
      ...initial,
      projects: {
        ...initial.projects,
        projects: {
          p: {
            id: "p",
            views: [TABLE, BOARD, MINE],
            defaultViewId: "view_table",
          } as unknown as Project,
        },
      },
    },
  });
  return {
    dispatch: store.dispatch as AppDispatch,
    state: () => store.getState() as unknown as RootState,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("saving a draft", () => {
  it.each(["save", "save as"])("keeps edits made while %s is pending", async (action) => {
    const { dispatch, state } = makeStore();
    dispatch(setDraftSort("p", SORT));
    const saved = { ...TABLE, definition: { ...TABLE.definition, sort: SORT } };
    let resolveResponse!: (response: { view: ViewConfig }) => void;
    const response = new Promise<{ view: ViewConfig }>((resolve) => {
      resolveResponse = resolve;
    });
    vi.mocked(projectsApi.updateView).mockReturnValue(response);
    vi.mocked(projectsApi.createView).mockReturnValue(response);
    const pending =
      action === "save"
        ? dispatch(saveViewDraft("p", TABLE.id))
        : dispatch(saveViewAs("p", TABLE, "Copy", ViewVisibility.PERSONAL));
    const laterSort = [{ field: fieldRef("field_due_date"), direction: SortDirection.DESC }];
    dispatch(setDraftSort("p", laterSort));

    resolveResponse({ view: action === "save" ? saved : { ...saved, id: "copy" } });
    await pending;

    expect(state().projectsUi.viewDrafts.p[TABLE.id].sort).toEqual(laterSort);
    expect(
      state().projects.projects.p.views.find((item) => item.id === saved.id)?.definition,
    ).toEqual(action === "save" ? saved.definition : TABLE.definition);
  });

  it("saves the draft into the view and leaves it clean", async () => {
    const { dispatch, state } = makeStore();
    dispatch(setDraftSort("p", SORT));
    const saved = { ...TABLE, definition: { ...TABLE.definition, sort: SORT } };
    vi.mocked(projectsApi.updateView).mockResolvedValue({ view: saved });

    expect(await dispatch(saveViewDraft("p", "view_table"))).toBe(true);
    expect(projectsApi.updateView).toHaveBeenCalledWith(
      "p",
      "view_table",
      { definition: saved.definition },
      "org",
    );
    expect(selectIsActiveViewDirty("p")(state())).toBe(false);
    expect(selectActiveView("p")(state())?.definition.sort).toEqual(SORT);
  });

  it("keeps the draft when the server refuses it", async () => {
    const { dispatch, state } = makeStore();
    dispatch(setDraftSort("p", SORT));
    vi.mocked(projectsApi.updateView).mockRejectedValue(new Error("definition: unknown field"));

    expect(await dispatch(saveViewDraft("p", "view_table"))).toBe(false);
    expect(selectIsActiveViewDirty("p")(state())).toBe(true);
  });

  it("saves as a new view, opens it and leaves the source untouched", async () => {
    const { dispatch, state } = makeStore();
    dispatch(setDraftSort("p", SORT));
    const created = view("new", "table", ViewVisibility.PERSONAL, 1, {
      ...TABLE.definition,
      sort: SORT,
    });
    vi.mocked(projectsApi.createView).mockResolvedValue({ view: created });

    await dispatch(saveViewAs("p", TABLE, "Mine sorted", ViewVisibility.PERSONAL));

    expect(projectsApi.createView).toHaveBeenCalledWith(
      "p",
      { name: "Mine sorted", definition: created.definition, visibility: ViewVisibility.PERSONAL },
      "org",
    );
    expect(projectsApi.updateView).not.toHaveBeenCalled();
    expect(selectActiveView("p")(state())?.id).toBe("new");
    expect(state().projectsUi.viewDrafts).toEqual({});
  });
});

describe("creating and removing views", () => {
  it("names a new view after its layout and makes it personal", async () => {
    const { dispatch } = makeStore();
    vi.mocked(projectsApi.createView).mockResolvedValue({ view: view("b2", "board") });
    await dispatch(createViewOfType("p", "board"));
    expect(projectsApi.createView).toHaveBeenCalledWith(
      "p",
      { name: "Board", definition: emptyDefinition("board"), visibility: ViewVisibility.PERSONAL },
      "org",
    );
  });

  it("duplicates what the view shows as a personal copy", async () => {
    const { dispatch } = makeStore();
    dispatch(openView({ projectId: "p", viewId: "view_table" }));
    dispatch(setDraftSort("p", SORT));
    vi.mocked(projectsApi.createView).mockResolvedValue({ view: view("copy", "table") });
    await dispatch(duplicateView("p", TABLE));
    expect(vi.mocked(projectsApi.createView).mock.calls[0][1]).toMatchObject({
      name: "view_table copy",
      visibility: ViewVisibility.PERSONAL,
      definition: { sort: SORT },
    });
  });

  it("falls back to the project default when the open view is deleted", async () => {
    const { dispatch, state } = makeStore();
    dispatch(openView({ projectId: "p", viewId: "view_board" }));
    dispatch(setDraftSort("p", SORT));
    vi.mocked(projectsApi.deleteView).mockResolvedValue({ success: true } as never);
    await dispatch(removeView("p", "view_board"));
    expect(selectActiveView("p")(state())?.id).toBe("view_table");
    expect(state().projectsUi.viewDrafts).toEqual({});
  });
});

describe("nextViewName", () => {
  it("numbers a name another view already uses", () => {
    const views = [view("a", "board"), view("b", "board")].map((v, index) => ({
      ...v,
      name: index === 0 ? "Board" : "board 2",
    }));
    expect(nextViewName(views, "Board")).toBe("Board 3");
    expect(nextViewName(views, "Roadmap")).toBe("Roadmap");
  });
});

describe("reorderedGroupIds", () => {
  const views = [TABLE, BOARD, view("graph", "graph", ViewVisibility.SHARED, 2), MINE];

  it("moves a view within its group and sends the whole group", () => {
    expect(reorderedGroupIds(views, "graph", "view_table")).toEqual({
      visibility: ViewVisibility.SHARED,
      ids: ["graph", "view_table", "view_board"],
    });
  });

  it("refuses a move across personal and shared views", () => {
    expect(reorderedGroupIds(views, "mine", "view_table")).toBeNull();
  });
});
