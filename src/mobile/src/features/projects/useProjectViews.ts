import { useCallback, useMemo, useState } from "react";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import { useAuth } from "@core/providers/AuthContext";
import type { SerializedProject, SerializedView } from "@features/projects/projectsSerializer";
import { rememberOpenedView, useLastOpenedView } from "@features/projects/lastOpenedViews";
import { setViewDraft, useViewDraft, type DraftScope } from "@features/projects/viewDrafts";
import { definitionsEqual } from "@features/projects/viewDefinition";
import {
  useCreateView,
  useDeleteView,
  useUpdateView,
} from "@features/projects/useProjectMutations";

/** Shared views first, then the caller's personal views, each in their saved order. */
function orderViews(views: readonly SerializedView[]): SerializedView[] {
  const rank = (view: SerializedView) => (view.visibility === "shared" ? 0 : 1);
  return [...views].sort((a, b) => rank(a) - rank(b) || a.sortOrder - b.sortOrder);
}

/**
 * The open view of a project and its working copy. A view named by a link wins, then the view
 * opened last on this device, then the project default. A remembered id the caller can no longer
 * see (deleted, or someone else's personal view) falls through the same way.
 */
export function useProjectViews(project: SerializedProject | undefined, linkedViewId?: string) {
  const { user, organizationId } = useAuth();
  const userId = user?.id;
  const projectId = project?.id;
  const views = useMemo(() => orderViews(project?.views ?? []), [project?.views]);
  const last = useLastOpenedView(userId, projectId);

  // Keyed by project and link so a new link, or a screen reused for another project, starts over.
  const [picked, setPicked] = useState<{ key: string; viewId: string } | null>(null);
  const pickKey = `${projectId}:${linkedViewId ?? ""}`;
  const pickedId = picked?.key === pickKey ? picked.viewId : undefined;

  const active = useMemo(() => {
    if (!project || (!last.ready && !linkedViewId && !pickedId)) return null;
    const byId = (id: string | undefined) => (id ? views.find((v) => v.id === id) : undefined);
    return (
      byId(pickedId) ??
      byId(linkedViewId) ??
      byId(last.viewId) ??
      byId(project.defaultViewId) ??
      views[0] ??
      null
    );
  }, [project, views, pickedId, linkedViewId, last.ready, last.viewId]);

  const scope = useMemo<DraftScope | null>(
    () => (userId && organizationId && projectId ? { userId, organizationId, projectId } : null),
    [userId, organizationId, projectId],
  );
  const draft = useViewDraft(scope, active?.id);
  const definition = draft ?? active?.definition;
  const dirty = !!draft && !!active && !definitionsEqual(draft, active.definition);

  const select = useCallback(
    (viewId: string) => {
      setPicked({ key: pickKey, viewId });
      if (userId && projectId) rememberOpenedView(userId, projectId, viewId);
    },
    [pickKey, userId, projectId],
  );

  const editDraft = useCallback(
    (next: ViewDefinition) => {
      if (!scope || !active) return;
      setViewDraft(scope, active.id, definitionsEqual(next, active.definition) ? null : next);
    },
    [scope, active],
  );

  const discard = useCallback(() => {
    if (scope && active) setViewDraft(scope, active.id, null);
  }, [scope, active]);

  const createView = useCreateView();
  const updateView = useUpdateView();
  const deleteView = useDeleteView();

  const ownsView = useCallback(
    (view: SerializedView) => view.visibility === "personal" && view.ownerId === userId,
    [userId],
  );

  const save = useCallback(() => {
    if (!projectId || !active || !draft || !ownsView(active)) return;
    updateView.mutate({ projectId, viewId: active.id, definition: draft }, { onSuccess: discard });
  }, [projectId, active, draft, ownsView, updateView, discard]);

  /** The working copy becomes a new personal view; the view it started from goes back to saved. */
  const saveAsNew = useCallback(
    (name: string, onDone?: () => void) => {
      if (!projectId || !active || !definition) return;
      createView.mutate(
        { projectId, name, definition },
        {
          onSuccess: (view) => {
            discard();
            select(view.id);
            onDone?.();
          },
        },
      );
    },
    [projectId, active, definition, createView, discard, select],
  );

  const rename = useCallback(
    (view: SerializedView, name: string, onDone?: () => void) => {
      if (!projectId || !ownsView(view)) return;
      updateView.mutate({ projectId, viewId: view.id, name }, { onSuccess: () => onDone?.() });
    },
    [projectId, ownsView, updateView],
  );

  const remove = useCallback(
    (view: SerializedView) => {
      if (!projectId || !ownsView(view) || !scope) return;
      deleteView.mutate(
        { projectId, viewId: view.id },
        {
          onSuccess: () => {
            setViewDraft(scope, view.id, null);
            // Deleting the open view lands on the project default, not on whatever
            // link or remembered view the screen happened to start from.
            const fallback = project?.defaultViewId || views.find((v) => v.id !== view.id)?.id;
            if (active?.id === view.id && fallback) select(fallback);
          },
        },
      );
    },
    [projectId, ownsView, scope, deleteView, project?.defaultViewId, views, active?.id, select],
  );

  return {
    views,
    active,
    definition,
    dirty,
    select,
    editDraft,
    discard,
    ownsView,
    save,
    saveAsNew,
    rename,
    remove,
    saving: createView.isPending || updateView.isPending,
  };
}
