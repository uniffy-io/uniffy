// Cold-load: when the user lands on dashboard directly, hydrate every slice it reads from. Guards stop retry loops.

import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { AppDispatch } from "@/app/store";
import { fetchNotes } from "@/features/notes/store/notesThunks";
import { fetchNotifications } from "@/features/notifications/store/notificationsSlice";
import { initializeFilesData } from "@/features/files/store/filesSlice";
import { fetchEventsInRange, fetchCategories } from "@/features/calendar/store/calendarThunks";
import { fetchProjects, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import { selectTaskListLoadedIds } from "@/features/projects/store/projectsSlice";

function fetchUpcomingEvents(dispatch: AppDispatch) {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
  dispatch(fetchEventsInRange({ startDate, endDate }));
}

// The widgets sample across projects; loading every page here would pull every task in the org.
function fetchTaskSample(dispatch: AppDispatch, projectId: string) {
  dispatch(fetchProjectTasks({ projectId, firstPageOnly: true }));
}

/** Loads what the dashboard reads; `refresh` reloads it on demand. */
export function useDashboardFetch(): { refresh: () => void } {
  const dispatch = useAppDispatch();
  const fetchedRef = useRef(false);
  const tasksFetchedRef = useRef(false);

  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
  const notesCount = useAppSelector((state) => Object.keys(state.notes?.notes ?? {}).length);
  const filesCount = useAppSelector((state) => Object.keys(state.files?.files ?? {}).length);
  const eventsCount = useAppSelector((state) => Object.keys(state.calendar?.events ?? {}).length);
  const projectsCount = useAppSelector(
    (state) => Object.keys(state.projects?.projects ?? {}).length,
  );
  const projects = useAppSelector((state) => state.projects.projects);
  const taskListLoadedIds = useAppSelector(selectTaskListLoadedIds);

  useEffect(() => {
    if (!orgId || fetchedRef.current) return;
    fetchedRef.current = true;

    if (notesCount === 0) {
      dispatch(fetchNotes({ page: 1, pageSize: 50 }));
    }

    if (filesCount === 0) {
      dispatch(initializeFilesData());
    }

    if (eventsCount === 0) {
      fetchUpcomingEvents(dispatch);
      dispatch(fetchCategories());
    }

    if (projectsCount === 0) {
      dispatch(fetchProjects());
    }

    // The bell only loads the list when its panel opens, and live pushes alone never backfill it.
    dispatch(fetchNotifications());

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Tasks are scoped per project, so this waits for the project list. A project opened earlier in
  // the session already holds its tasks; every other project still needs its sample.
  useEffect(() => {
    if (tasksFetchedRef.current) return;
    const ids = Object.keys(projects);
    if (ids.length === 0) return;
    tasksFetchedRef.current = true;

    for (const id of ids) {
      if (!taskListLoadedIds[id]) fetchTaskSample(dispatch, id);
    }
  }, [projects, taskListLoadedIds, dispatch]);

  const refresh = useCallback(() => {
    dispatch(fetchNotes({ page: 1, pageSize: 50 }));
    dispatch(initializeFilesData());
    fetchUpcomingEvents(dispatch);
    dispatch(fetchNotifications());
    void dispatch(fetchProjects())
      .unwrap()
      .then((fresh) => {
        for (const project of fresh) fetchTaskSample(dispatch, project.id);
      })
      // The rejected thunk already surfaced through the error toast middleware.
      .catch(() => {});
  }, [dispatch]);

  return { refresh };
}
