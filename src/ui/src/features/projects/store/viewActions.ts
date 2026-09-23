import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import { arrayMove } from "@dnd-kit/sortable";
import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { RootState } from "@/app/store";
import type { ViewConfig, ViewDefinition, ViewType } from "@/features/projects/types/views";
import {
  createViewThunk,
  deleteViewThunk,
  reorderViewsThunk,
  updateProject,
  updateViewThunk,
} from "@/features/projects/store/projectsThunks";
import { dropViewDraft, openView } from "@/features/projects/store/projectsUiSlice";
import { selectProjectViews } from "@/features/projects/store/viewSelectors";
import { emptyDefinition } from "@/features/projects/utils/viewDraft";
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

/** Writes the open draft into its view; the draft goes once the server has the definition. */
export function saveViewDraft(projectId: string, viewId: string): ViewThunk<boolean> {
  return async (dispatch, getState) => {
    const definition = draftOf(getState(), projectId, viewId);
    if (!definition) return false;
    const result = await dispatch(updateViewThunk({ projectId, viewId, updates: { definition } }));
    if (!updateViewThunk.fulfilled.match(result)) return false;
    dispatch(dropViewDraft({ projectId, viewId }));
    return true;
  };
}

interface CreateViewArgs {
  projectId: string;
  name: string;
  definition: ViewDefinition;
  visibility: ViewVisibility;
}

/** Creates a view and opens it. */
export function createAndOpenView(args: CreateViewArgs): ViewThunk<ViewConfig | null> {
  return async (dispatch) => {
    const result = await dispatch(createViewThunk(args));
    if (!createViewThunk.fulfilled.match(result)) return null;
    dispatch(openView({ projectId: args.projectId, viewId: result.payload.id }));
    return result.payload;
  };
}

/**
 * Saves what a view currently shows as a new view. The source view keeps its saved definition:
 * its draft moves to the new view instead of staying behind as unsaved edits.
 */
export function saveViewAs(
  projectId: string,
  source: ViewConfig,
  name: string,
  visibility: ViewVisibility,
): ViewThunk<ViewConfig | null> {
  return async (dispatch, getState) => {
    const definition = draftOf(getState(), projectId, source.id) ?? source.definition;
    const created = await dispatch(createAndOpenView({ projectId, name, definition, visibility }));
    if (created) dispatch(dropViewDraft({ projectId, viewId: source.id }));
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

/** The ids of one visibility group with `viewId` moved to where `targetViewId` sits. */
export function reorderedGroupIds(
  views: readonly ViewConfig[],
  viewId: string,
  targetViewId: string,
): { visibility: ViewVisibility; ids: string[] } | null {
  const moving = views.find((view) => view.id === viewId);
  const target = views.find((view) => view.id === targetViewId);
  if (!moving || !target || moving.visibility !== target.visibility || viewId === targetViewId) {
    return null;
  }
  const ids = views.filter((view) => view.visibility === moving.visibility).map((view) => view.id);
  return {
    visibility: moving.visibility,
    ids: arrayMove(ids, ids.indexOf(viewId), ids.indexOf(targetViewId)),
  };
}

export function moveView(
  projectId: string,
  viewId: string,
  targetViewId: string,
): ViewThunk<boolean> {
  return async (dispatch, getState) => {
    const order = reorderedGroupIds(
      selectProjectViews(projectId)(getState()),
      viewId,
      targetViewId,
    );
    if (!order) return false;
    const result = await dispatch(
      reorderViewsThunk({ projectId, visibility: order.visibility, viewIds: order.ids }),
    );
    return reorderViewsThunk.fulfilled.match(result);
  };
}
