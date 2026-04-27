/**
 * useDashboardFetch - Ensures domain data is loaded for dashboard widgets.
 *
 * The dashboard reads from multiple Redux slices (notes, files, calendar,
 * projects, bookmarks). If the user navigates directly to the dashboard
 * without visiting those pages first, the stores are empty.
 *
 * This hook dispatches the essential fetch thunks once on mount so every
 * widget has data to render. Guards prevent duplicate or retry-loop requests.
 */

import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { fetchNotes } from '@/features/notes/store/notesThunks';
import { initializeFilesData } from '@/features/files/store/filesSlice';
import { fetchEventsInRange, fetchCategories } from '@/features/calendar/store/calendarThunks';
import { fetchProjects, fetchProjectTasks } from '@/features/projects/store/projectsThunks';
import { fetchBookmarks } from '@/features/bookmarks';

export function useDashboardFetch() {
    const dispatch = useAppDispatch();
    const fetchedRef = useRef(false);
    const tasksFetchedRef = useRef(false);

    const orgId = useAppSelector((state) => state.auth.currentOrganizationId);
    const notesCount = useAppSelector((state) => Object.keys(state.notes?.notes ?? {}).length);
    const filesCount = useAppSelector((state) => Object.keys(state.files?.files ?? {}).length);
    const eventsCount = useAppSelector((state) => Object.keys(state.calendar?.events ?? {}).length);
    const projectsCount = useAppSelector((state) => Object.keys(state.projects?.projects ?? {}).length);
    const projects = useAppSelector((state) => state.projects?.projects ?? {});
    const tasksCount = useAppSelector((state) => Object.keys(state.projects?.tasks ?? {}).length);
    const bookmarksCount = useAppSelector((state) => Object.keys(state.bookmarks?.bookmarks ?? {}).length);

    // Phase 1: fetch all top-level domain data once
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
            const now = new Date();
            const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
            dispatch(fetchEventsInRange({ startDate, endDate }));
            dispatch(fetchCategories());
        }

        if (projectsCount === 0) {
            dispatch(fetchProjects());
        }

        if (bookmarksCount === 0) {
            dispatch(fetchBookmarks());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId]);

    // Phase 2: once projects are loaded, fetch tasks for each (once only)
    useEffect(() => {
        if (tasksFetchedRef.current) return;
        const ids = Object.keys(projects);
        if (ids.length === 0 || tasksCount > 0) return;
        tasksFetchedRef.current = true;

        for (const id of ids) {
            dispatch(fetchProjectTasks(id));
        }
    }, [projects, tasksCount, dispatch]);
}
