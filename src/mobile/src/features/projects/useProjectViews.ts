import { useCallback, useMemo, useState } from "react";
import type { ViewDefinition } from "@uniffy/proto/projects/v1/projects_pb";
import { useAuth } from "@core/providers/AuthContext";
import { isCurrentSession, sessionGeneration } from "@core/auth/sessionScope";
import type { ProjectViewScope } from "@features/projects/projectViewsCache";
import type { SerializedProject, SerializedView } from "@features/projects/projectsSerializer";
import { rememberOpenedView, useLastOpenedView } from "@features/projects/lastOpenedViews";
import {
  beginViewSave,
  editViewDraft,
  finishViewSave,
  setViewDraft,
  useViewDraft,
  type DraftScope,
} from "@features/projects/viewDrafts";
import { definitionsEqual } from "@features/projects/viewDefinition";
import { resolveProjectView } from "@features/projects/viewSelection";
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

/** Inaccessible view ids fall back to the remembered view or the project default. */
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
    if (!project || (views.length > 0 && !last.ready && !linkedViewId && !pickedId)) return null;
    return resolveProjectView(views, [pickedId, linkedViewId, last.viewId, project.defaultViewId]);
  }, [project, views, pickedId, linkedViewId, last.ready, last.viewId]);

  const generation = sessionGeneration();
  const scope = useMemo<(DraftScope & ProjectViewScope) | null>(
    () =>
      userId && organizationId && projectId
        ? { userId, organizationId, projectId, generation }
        : null,
    [userId, organizationId, projectId, generation],
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
      editViewDraft(scope, active.id, next, active.definition);
    },
    [scope, active],
  );

  const discard = useCallback(() => {
    if (scope && active) {
      editViewDraft(scope, active.id, active.definition, active.definition);
    }
  }, [scope, active]);

  const createView = useCreateView();
  const updateView = useUpdateView();
  const deleteView = useDeleteView();

  const ownsView = useCallback(
    (view: SerializedView) => view.visibility === "personal" && view.ownerId === userId,
    [userId],
  );

  const save = useCallback(async () => {
    if (!scope || !projectId || !active || !draft || !ownsView(active)) return;
    const pending = beginViewSave(scope, active.id, draft);
    if (!pending) return;
    try {
      await updateView.mutateAsync({ scope, projectId, viewId: active.id, definition: draft });
      finishViewSave(pending, isCurrentSession(scope.generation));
    } catch {
      finishViewSave(pending, false);
    }
  }, [scope, projectId, active, draft, ownsView, updateView]);

  const saveAsNew = useCallback(
    async (name: string, onDone?: () => void) => {
      if (!scope || !projectId || !active || !definition) return;
      const pending = beginViewSave(scope, active.id, definition);
      if (!pending) return;
      try {
        const view = await createView.mutateAsync({ scope, projectId, name, definition });
        const current = isCurrentSession(scope.generation);
        finishViewSave(pending, current);
        if (current) {
          select(view.id);
          onDone?.();
        }
      } catch {
        finishViewSave(pending, false);
      }
    },
    [scope, projectId, active, definition, createView, select],
  );

  const rename = useCallback(
    (view: SerializedView, name: string, onDone?: () => void) => {
      if (!scope || !projectId || !ownsView(view)) return;
      updateView.mutate(
        { scope, projectId, viewId: view.id, name },
        {
          onSuccess: () => {
            if (isCurrentSession(scope.generation)) onDone?.();
          },
        },
      );
    },
    [scope, projectId, ownsView, updateView],
  );

  const remove = useCallback(
    (view: SerializedView) => {
      if (!projectId || !ownsView(view) || !scope) return;
      deleteView.mutate(
        { scope, projectId, viewId: view.id },
        {
          onSuccess: () => {
            if (!isCurrentSession(scope.generation)) return;
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
