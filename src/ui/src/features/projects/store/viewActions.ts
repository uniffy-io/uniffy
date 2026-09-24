import { nanoid, type ThunkAction, type UnknownAction } from "@reduxjs/toolkit";
import { arrayMove } from "@dnd-kit/sortable";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { RootState } from "@/app/store";
import type { ViewConfig, ViewDefinition, ViewType } from "@/features/projects/types/views";
import {
  createViewThunk,
  deleteViewThunk,
  updateProject,
  updateViewThunk,
} from "@/features/projects/store/projectsThunks";
import {
  beginViewSave,
  dropViewDraft,
  finishViewSave,
  openView,
  setViewTabOrder,
} from "@/features/projects/store/projectsUiSlice";
import { selectIsViewSaving, selectProjectViews } from "@/features/projects/store/viewSelectors";
import { definitionsEqual, emptyDefinition } from "@/features/projects/utils/viewDraft";
import { VIEW_TYPE_OPTIONS } from "@/features/projects/utils/viewTypes";

type ViewThunk<T = void> = ThunkAction<Promise<T>, RootState, undefined, UnknownAction>;

/** "Board", then "Board 2", "Board 3": the first name no visible view of the project uses. */
export function nextViewName(views: readonly ViewConfig[], base: string): string {
  const taken = new Set(views.map((view) => view.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;
  return `${base} ${suffix}`;
}

function draftOf(state: RootState, projectId: string, viewId: string): ViewDefinition | undefined {
  return state.projectsUi.viewDrafts[projectId]?.[viewId];
}

export function saveViewDraft(projectId: string, viewId: string): ViewThunk<boolean> {
  return async (dispatch, getState) => {
    const state = getState();
    const definition = draftOf(state, projectId, viewId);
    if (!definition || selectIsViewSaving(projectId, viewId)(state)) return false;
    const requestId = nanoid();
    dispatch(beginViewSave({ projectId, viewId, requestId }));
    try {
      const result = await dispatch(
        updateViewThunk({ projectId, viewId, updates: { definition } }),
      );
      return updateViewThunk.fulfilled.match(result);
    } finally {
      const saved = selectProjectViews(projectId)(getState()).find((view) => view.id === viewId);
      dispatch(finishViewSave({ projectId, viewId, requestId, definition: saved?.definition }));
    }
  };
}

interface CreateViewArgs {
  projectId: string;
  name: string;
  definition: ViewDefinition;
  visibility: ViewVisibility;
}

export function createAndOpenView(args: CreateViewArgs): ViewThunk<ViewConfig | null> {
  return async (dispatch) => {
    const result = await dispatch(createViewThunk(args));
    if (!createViewThunk.fulfilled.match(result)) return null;
    dispatch(openView({ projectId: args.projectId, viewId: result.payload.id }));
    return result.payload;
  };
}

export function saveViewAs(
  projectId: string,
  source: ViewConfig,
  name: string,
  visibility: ViewVisibility,
): ViewThunk<ViewConfig | null> {
  return async (dispatch, getState) => {
    const definition = draftOf(getState(), projectId, source.id) ?? source.definition;
    const created = await dispatch(createAndOpenView({ projectId, name, definition, visibility }));
    const current = draftOf(getState(), projectId, source.id);
    if (created && current && definitionsEqual(current, definition)) {
      dispatch(dropViewDraft({ projectId, viewId: source.id }));
    }
    return created;
  };
}

export function createViewOfType(projectId: string, type: ViewType): ViewThunk<ViewConfig | null> {
  return (dispatch, getState) => {
    const label = VIEW_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? "View";
    const name = nextViewName(selectProjectViews(projectId)(getState()), label);
    return dispatch(
      createAndOpenView({
        projectId,
        name,
        definition: emptyDefinition(type),
        visibility: ViewVisibility.PERSONAL,
      }),
    );
  };
}

/** A personal copy of what the view shows now, draft included. */
export function duplicateView(projectId: string, source: ViewConfig): ViewThunk<ViewConfig | null> {
  return (dispatch, getState) => {
    const state = getState();
    return dispatch(
      createAndOpenView({
        projectId,
        name: nextViewName(selectProjectViews(projectId)(state), `${source.name} copy`),
        definition: draftOf(state, projectId, source.id) ?? source.definition,
        visibility: ViewVisibility.PERSONAL,
      }),
    );
  };
}

export function renameView(projectId: string, viewId: string, name: string): ViewThunk<boolean> {
  return async (dispatch) => {
    const result = await dispatch(updateViewThunk({ projectId, viewId, updates: { name } }));
    return updateViewThunk.fulfilled.match(result);
  };
}

export function setViewVisibility(
  projectId: string,
  viewId: string,
  visibility: ViewVisibility,
): ViewThunk<boolean> {
  return async (dispatch) => {
    const result = await dispatch(updateViewThunk({ projectId, viewId, updates: { visibility } }));
    return updateViewThunk.fulfilled.match(result);
  };
}

/** The draft goes with the view; an open view that disappears falls back to the project default. */
export function removeView(projectId: string, viewId: string): ViewThunk<boolean> {
  return async (dispatch) => {
    const result = await dispatch(deleteViewThunk({ projectId, viewId }));
    if (!deleteViewThunk.fulfilled.match(result)) return false;
    dispatch(dropViewDraft({ projectId, viewId }));
    return true;
  };
}

export function setDefaultView(projectId: string, viewId: string): ViewThunk<boolean> {
  return async (dispatch) => {
    const result = await dispatch(updateProject({ id: projectId, defaultViewId: viewId }));
    return updateProject.fulfilled.match(result);
  };
}

export function moveView(
  projectId: string,
  viewId: string,
  targetViewId: string,
): ThunkAction<boolean, RootState, undefined, UnknownAction> {
  return (dispatch, getState) => {
    const ids = selectProjectViews(projectId)(getState()).map((view) => view.id);
    const from = ids.indexOf(viewId);
    const to = ids.indexOf(targetViewId);
    if (from === -1 || to === -1 || from === to) return false;
    dispatch(setViewTabOrder({ projectId, viewIds: arrayMove(ids, from, to) }));
    return true;
  };
}
