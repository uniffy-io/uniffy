import { createRouteLoader } from "@/shared/utils/createRouteLoader";

export const { load: loadDashboard, preload: preloadDashboard } = createRouteLoader(
  () => import("@/features/dashboard/components/Dashboard"),
);

export const { load: loadNotesPage, preload: preloadNotesPage } = createRouteLoader(
  () => import("@/features/notes/pages/NotesPage"),
);

export const { load: loadFilesPage, preload: preloadFilesPage } = createRouteLoader(
  () => import("@/features/files/pages/FilesPage"),
);

export const { load: loadCalendarPage, preload: preloadCalendarPage } = createRouteLoader(
  () => import("@/features/calendar/pages/CalendarPage"),
);

export const { load: loadProjectsPage, preload: preloadProjectsPage } = createRouteLoader(
  () => import("@/features/projects/pages/ProjectsPage"),
);

export const { load: loadAgentsPage, preload: preloadAgentsPage } = createRouteLoader(
  () => import("@/features/agents/pages/AgentsPage"),
);
