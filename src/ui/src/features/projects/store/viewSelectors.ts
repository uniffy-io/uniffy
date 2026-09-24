import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { ViewConfig, ViewDefinition, ViewType } from "@/features/projects/types/views";
import { definitionsEqual, emptyDefinition } from "@/features/projects/utils/viewDraft";

const NO_VIEWS: readonly ViewConfig[] = Object.freeze([]);
const NO_VIEW_ORDER: readonly string[] = Object.freeze([]);
const NO_DRAFTS: Readonly<Record<string, ViewDefinition>> = Object.freeze({});
const NO_DIRTY_VIEWS: readonly string[] = Object.freeze([]);
const FALLBACK_DEFINITION: ViewDefinition = Object.freeze(emptyDefinition("table"));

/** One memoized selector per project, so a component keeps the same instance across renders. */
function perProject<T>(build: (projectId: string) => (state: RootState) => T) {
  const cache = new Map<string, (state: RootState) => T>();
  return (projectId: string) => {
    let selector = cache.get(projectId);
    if (!selector) {
      selector = build(projectId);
      cache.set(projectId, selector);
    }
    return selector;
  };
}

/** Apply personal order only to visible views, appending views absent from that order. */
export const selectProjectViews = perProject((projectId) =>
  createSelector(
    [
      (state: RootState) => state.projects.projects[projectId]?.views ?? NO_VIEWS,
      (state: RootState) => state.projectsUi.viewTabOrder[projectId] ?? NO_VIEW_ORDER,
    ],
    (views, order): readonly ViewConfig[] => {
      if (order.length === 0) return views;
      const remaining = new Map(views.map((view) => [view.id, view]));
      const ordered: ViewConfig[] = [];
      for (const id of order) {
        const view = remaining.get(id);
        if (!view) continue;
        ordered.push(view);
        remaining.delete(id);
      }
      return [...ordered, ...remaining.values()];
    },
  ),
);

const selectDrafts = (projectId: string) => (state: RootState) =>
  state.projectsUi.viewDrafts[projectId] ?? NO_DRAFTS;

export const selectIsViewSaving = (projectId: string, viewId: string) => (state: RootState) =>
  Boolean(state.projectsUi.viewSaveRequests[projectId]?.[viewId]);

/**
 * The view opened last, else the project default, else the first view. A remembered id the caller
 * can no longer see (deleted, or made personal by someone else) falls through the same way.
 */
export function resolveActiveView(
  views: readonly ViewConfig[],
  rememberedId: string | undefined,
  defaultViewId: string | undefined,
): ViewConfig | null {
  return (
    views.find((view) => view.id === rememberedId) ??
    views.find((view) => view.id === defaultViewId) ??
    views[0] ??
    null
  );
}

export const selectActiveView = perProject((projectId) =>
  createSelector(
    [
      selectProjectViews(projectId),
      (state: RootState) => state.projectsUi.activeViewIds[projectId],
      (state: RootState) => state.projects.projects[projectId]?.defaultViewId,
    ],
    resolveActiveView,
  ),
);

/** What the layouts render: the unsaved draft when there is one, else the saved definition. */
export const selectActiveDefinition = perProject((projectId) =>
  createSelector(
    [selectActiveView(projectId), selectDrafts(projectId)],
    (view, drafts): ViewDefinition =>
      view ? (drafts[view.id] ?? view.definition) : FALLBACK_DEFINITION,
  ),
);

export const selectActiveViewType =
  (projectId: string) =>
  (state: RootState): ViewType =>
    selectActiveDefinition(projectId)(state).layout.type;

export const selectDirtyViewIds = perProject((projectId) =>
  createSelector([selectProjectViews(projectId), selectDrafts(projectId)], (views, drafts) => {
    const dirty = views
      .filter((view) => drafts[view.id] && !definitionsEqual(drafts[view.id], view.definition))
      .map((view) => view.id);
    return dirty.length === 0 ? NO_DIRTY_VIEWS : dirty;
  }),
);

export const selectIsActiveViewDirty = (projectId: string) => (state: RootState) => {
  const view = selectActiveView(projectId)(state);
  return view !== null && selectDirtyViewIds(projectId)(state).includes(view.id);
};

export const selectDraftFilter = (projectId: string) => (state: RootState) =>
  selectActiveDefinition(projectId)(state).filter;

export const selectDraftSort = (projectId: string) => (state: RootState) =>
  selectActiveDefinition(projectId)(state).sort;

export const selectDraftGroupBy = (projectId: string) => (state: RootState) =>
  selectActiveDefinition(projectId)(state).groupBy;

export const selectDraftLayout = (projectId: string) => (state: RootState) =>
  selectActiveDefinition(projectId)(state).layout;
