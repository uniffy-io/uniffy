import type { ThunkAction, UnknownAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type {
  ViewDefinition,
  ViewFieldRef,
  ViewFilterGroup,
  ViewGroupBy,
  ViewLayout,
  ViewSortKey,
} from "@/features/projects/types/views";
import { dropViewDraft, putViewDraft } from "@/features/projects/store/projectsUiSlice";
import { selectActiveDefinition, selectActiveView } from "@/features/projects/store/viewSelectors";
import {
  definitionsEqual,
  toggleCollapsedKey,
  withColumnWidth,
} from "@/features/projects/utils/viewDraft";

type DraftThunk = ThunkAction<void, RootState, undefined, UnknownAction>;

/**
 * Applies an edit to the open view of a project. The result is kept as a draft only while it
 * differs from the saved definition, so undoing an edit by hand leaves the view clean.
 */
export function editActiveDraft(
  projectId: string,
  edit: (definition: ViewDefinition) => ViewDefinition,
): DraftThunk {
  return (dispatch, getState) => {
    const state = getState();
    const view = selectActiveView(projectId)(state);
    if (!view) return;
    const next = edit(selectActiveDefinition(projectId)(state));
    if (definitionsEqual(next, view.definition)) {
      dispatch(dropViewDraft({ projectId, viewId: view.id }));
    } else {
      dispatch(putViewDraft({ projectId, viewId: view.id, definition: next }));
    }
  };
}

export const setDraftFilter = (projectId: string, filter: ViewFilterGroup | null) =>
  editActiveDraft(projectId, (definition) => ({
    ...definition,
    filter: filter && filter.nodes.length > 0 ? filter : null,
  }));

export const setDraftSort = (projectId: string, sort: ViewSortKey[]) =>
  editActiveDraft(projectId, (definition) => ({ ...definition, sort }));

/** A new grouping starts with every group open; keys of the previous grouping mean nothing now. */
export const setDraftGroupBy = (projectId: string, groupBy: ViewGroupBy | null) =>
  editActiveDraft(projectId, (definition) => ({
    ...definition,
    groupBy,
    collapsedGroupKeys: [],
  }));

export const setDraftVisibleFields = (projectId: string, visibleFields: ViewFieldRef[]) =>
  editActiveDraft(projectId, (definition) => ({ ...definition, visibleFields }));

export const setDraftColumnWidth = (projectId: string, field: ViewFieldRef, width: number) =>
  editActiveDraft(projectId, (definition) => ({
    ...definition,
    columnWidths: withColumnWidth(definition.columnWidths, field, width),
  }));

export const toggleDraftCollapsedGroup = (projectId: string, key: string) =>
  editActiveDraft(projectId, (definition) => ({
    ...definition,
    collapsedGroupKeys: toggleCollapsedKey(definition.collapsedGroupKeys, key),
  }));

/** A view's layout type is fixed; only settings of the same layout apply. */
export const setDraftLayout = (projectId: string, layout: ViewLayout) =>
  editActiveDraft(projectId, (definition) =>
    definition.layout.type === layout.type ? { ...definition, layout } : definition,
  );
