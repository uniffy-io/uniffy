import { configureStore, combineReducers } from "@reduxjs/toolkit";
import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  createMigrate,
  createTransform,
} from "redux-persist";
import type { PersistedState, MigrationManifest } from "redux-persist";
import storage from "redux-persist/lib/storage";
import { authReducer } from "@/features/auth/store/authSlice";
import { instantDayKey } from "@/features/calendar/utils";
import { QUICK_ACCESS_FILTERS } from "@/features/calendar/types/calendar";
import { setPreferredTimeZone } from "@/shared/utils/timezone";
import { setPreferredWeekStart } from "@/shared/utils/weekStart";
import type { AuthState } from "@/features/auth/store/authSlice";
import { bookmarksReducer } from "@/features/bookmarks/store/bookmarksSlice";
import { libraryGraphReducer } from "@/features/library/store/graphSlice";
import { themeReducer } from "@/config/theme/themeSlice";
import { notesReducer } from "@/features/notes/store/notesSlice";
import { notesTreeReducer } from "@/features/notes/store/notesTreeSlice";
import { editorReducer } from "@/features/notes/store/editorSlice";
import { settingsReducer } from "@/features/settings/store/settingsSlice";
import { permissionsReducer } from "@/features/permissions/store/permissionsSlice";
import { accessRequestsReducer } from "@/features/permissions/store/accessRequestsSlice";
import { adminReducer } from "@/features/admin/store/adminSlice";
import { agentsGovernanceReducer } from "@/features/admin/store/agentsGovernanceSlice";
import { agentRuntimeSettingsReducer } from "@/features/admin/store/agentRuntimeSettingsSlice";
import { setStoreRef } from "@/app/storeRef";
import { calendarReducer, calendarUiReducer } from "@/features/calendar/store";
import { zenModeReducer } from "@/app/zenModeSlice";
import { filesReducer } from "@/features/files/store/filesSlice";
import { filesTreeReducer } from "@/features/files/store/filesTreeSlice";
import { uploadReducer } from "@/features/files/store/uploadSlice";
import { savedFiltersReducer } from "@/features/files/store/savedFiltersSlice";
import { viewerReducer } from "@/features/files/store/viewerSlice";
import { trashReducer } from "@/features/files/store/trashSlice";
import { imageEditorReducer } from "@/features/files/store/imageEditorSlice";
import { notificationsReducer } from "@/features/notifications/store/notificationsSlice";
import { notificationsPageReducer } from "@/features/notifications/store/notificationsPageSlice";
import { sessionsReducer } from "@/features/settings/store/sessionsSlice";
import { commentsReducer } from "@/features/comments/store/commentsSlice";
import { projectsReducer } from "@/features/projects/store/projectsSlice";
import { projectsUiReducer } from "@/features/projects/store/projectsUiSlice";
import { loadColumnWidths, loadHiddenColumns } from "@/features/projects/utils/tableColumnStorage";
import { agentsUiReducer } from "@/features/agents/store/agentsUiSlice";
import { agentsReducer } from "@/features/agents/store/agentsSlice";
import { agentSessionsReducer } from "@/features/agents/store/agentSessionsSlice";
import { agentMessagesReducer } from "@/features/agents/store/agentMessagesSlice";
import { agentSkillsReducer } from "@/features/agents/store/agentSkillsSlice";
import { agentRulesReducer } from "@/features/agents/store/agentRulesSlice";
import { agentTemplatesReducer } from "@/features/agents/store/agentTemplatesSlice";
import { agentToolsReducer } from "@/features/agents/store/agentToolsSlice";
import { agentRunnableSkillsReducer } from "@/features/agents/store/agentRunnableSkillsSlice";
import { agentSkillDraftsReducer } from "@/features/agents/store/agentSkillDraftsSlice";
import { agentSkillVersionsReducer } from "@/features/agents/store/agentSkillVersionsSlice";
import { agentSkillMetricsReducer } from "@/features/agents/store/agentSkillMetricsSlice";
import { agentProvidersReducer } from "@/features/agents/store/agentProvidersSlice";
import { agentUsageReducer } from "@/features/agents/store/agentUsageSlice";
import { agentCronReducer } from "@/features/agents/store/agentCronSlice";
import { agentMemoriesReducer } from "@/features/agents/store/agentMemoriesSlice";
import { integrationsReducer } from "@/features/integrations/store/integrationsSlice";
import { errorToastMiddleware } from "@/app/errorToastMiddleware";
import { contentAccessMiddleware } from "@/app/contentAccessMiddleware";
import { presenceReducer } from "@/features/presence/store/presenceSlice";
import { sprintsReducer } from "@/features/projects/store/sprintsSlice";
import { roomsReducer } from "@/features/rooms/store/roomsSlice";
import { chatChannelsReducer } from "@/features/chat/store/chatChannelsSlice";
import { chatMessagesReducer } from "@/features/chat/store/chatMessagesSlice";
import { chatThreadsReducer } from "@/features/chat/store/chatThreadsSlice";
import { chatUiReducer } from "@/features/chat/store/chatUiSlice";
import { chatDraftsReducer } from "@/features/chat/store/chatDraftsSlice";
import { tagsReducer } from "@/features/tags/store/tagsSlice";
import { peopleReducer } from "@/features/people/store/peopleSlice";
import { recordingReducer } from "@/features/recording/store/recordingSlice";
import { callsReducer } from "@/features/calls/store/callsSlice";
import { callPreferencesReducer } from "@/features/calls/store/callPreferencesSlice";

/** Access tokens live in memory only to reduce XSS surface; refresh token recovers them on reload. */
const authSecurityTransform = createTransform(
  (inboundState: AuthState) => ({
    ...inboundState,
    accessToken: null,
  }),
  (outboundState: AuthState) => ({
    ...outboundState,
    accessToken: null,
    isAuthenticated: false,
  }),
  { whitelist: ["auth"] },
);

/** Calendar opens to today, not the last viewed date; other UI prefs survive. */
const calendarUiTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    currentDate: instantDayKey(new Date()),
    // A filter persisted under an older vocabulary matches every event and
    // highlights no pill, which reads as a broken calendar rather than a reset.
    quickAccessFilter: QUICK_ACCESS_FILTERS.includes(outboundState?.quickAccessFilter)
      ? outboundState.quickAccessFilter
      : null,
  }),
  { whitelist: ["calendarUi"] },
);

/** Preserve layout prefs; reset selections, modals, drag, undo, autosave. Column state lives in localStorage. */
const projectsUiTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { columnWidths, hiddenColumns, ...rest } = inboundState ?? {};
    return rest;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    columnWidths: loadColumnWidths(),
    hiddenColumns: loadHiddenColumns(),
    selectedTaskId: null,
    selectedTaskIds: [],
    isCreateProjectModalOpen: false,
    editProjectId: null,
    isCreateTaskModalOpen: false,
    isFieldPickerOpen: false,
    isViewConfigOpen: false,
    editingFieldId: null,
    dragState: null,
    editingCell: null,
    focusedCell: null,
    searchQuery: "",
    undoStack: [],
    redoStack: [],
    autosave: { isSaving: {}, lastSaved: {}, hasChanges: {} },
  }),
  { whitelist: ["projectsUi"] },
);

/** Force `idle` on rehydrate - MediaRecorder/MediaStream can't survive a reload. Picker prefs persist. */
const recordingTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    state: "idle",
    network: "online",
    auth: "ok",
    uploadId: null,
    startedAt: null,
    pausedDurationMs: 0,
    pausedAt: null,
    bytesQueued: 0,
    bytesUploaded: 0,
    lastFileId: null,
    error: null,
    firstUseModalOpen: false,
  }),
  { whitelist: ["recording"] },
);

/** Keep layout prefs and the last-visited section; drop search and any stale keys. */
const agentsUiTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    lastSection: outboundState.lastSection ?? "agents",
    sidebarCollapsed: outboundState.sidebarCollapsed ?? false,
    sidebarSearch: "",
  }),
  { whitelist: ["agentsUi"] },
);

const rootReducer = combineReducers({
  auth: authReducer,
  bookmarks: bookmarksReducer,
  libraryGraph: libraryGraphReducer,
  theme: themeReducer,
  notes: notesReducer,
  notesTree: notesTreeReducer,
  editor: editorReducer,
  settings: settingsReducer,
  permissions: permissionsReducer,
  accessRequests: accessRequestsReducer,
  admin: adminReducer,
  agentsGovernance: agentsGovernanceReducer,
  agentRuntimeSettings: agentRuntimeSettingsReducer,
  calendar: calendarReducer,
  calendarUi: calendarUiReducer,
  projects: projectsReducer,
  projectsUi: projectsUiReducer,
  agentsUi: agentsUiReducer,
  agents: agentsReducer,
  agentSessions: agentSessionsReducer,
  agentMessages: agentMessagesReducer,
  agentSkills: agentSkillsReducer,
  agentRules: agentRulesReducer,
  agentTemplates: agentTemplatesReducer,
  agentTools: agentToolsReducer,
  agentRunnableSkills: agentRunnableSkillsReducer,
  agentSkillDrafts: agentSkillDraftsReducer,
  agentSkillVersions: agentSkillVersionsReducer,
  agentSkillMetrics: agentSkillMetricsReducer,
  agentProviders: agentProvidersReducer,
  agentUsage: agentUsageReducer,
  agentCron: agentCronReducer,
  agentMemories: agentMemoriesReducer,
  integrations: integrationsReducer,
  sprints: sprintsReducer,
  rooms: roomsReducer,
  zenMode: zenModeReducer,
  files: filesReducer,
  filesTree: filesTreeReducer,
  upload: uploadReducer,
  savedFilters: savedFiltersReducer,
  fileViewer: viewerReducer,
  trash: trashReducer,
  imageEditor: imageEditorReducer,
  notifications: notificationsReducer,
  notificationsPage: notificationsPageReducer,
  presence: presenceReducer,
  sessions: sessionsReducer,
  comments: commentsReducer,
  chatChannels: chatChannelsReducer,
  chatMessages: chatMessagesReducer,
  chatThreads: chatThreadsReducer,
  chatUi: chatUiReducer,
  chatDrafts: chatDraftsReducer,
  tags: tagsReducer,
  people: peopleReducer,
  recording: recordingReducer,
  calls: callsReducer,
  callPreferences: callPreferencesReducer,
});

const migrations: MigrationManifest = {
  2: (state: PersistedState) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = state as any;
    if (s?.theme?.currentTheme && !s.theme.themeMode) {
      const oldTheme = s.theme.currentTheme;
      let newMode: "system" | "light" | "dark" = "system";
      if (oldTheme === "dark") {
        newMode = "dark";
      } else if (oldTheme === "default" || oldTheme === "light") {
        newMode = "light";
      }
      return {
        ...s,
        theme: {
          ...s.theme,
          themeMode: newMode,
          currentTheme: undefined,
        },
      };
    }
    return state;
  },
  3: (state: PersistedState) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = state as any;
    if (s?.auth) {
      return {
        ...s,
        auth: {
          ...s.auth,
          accessToken: null,
          isAuthenticated: false,
        },
      };
    }
    return state;
  },
  4: (state: PersistedState) => {
    // Slices are reconciled wholesale, so a key added to chatUi after a session
    // was persisted arrives undefined; the archived section starts closed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = state as any;
    if (s?.chatUi && s.chatUi.archivedSectionCollapsed === undefined) {
      return {
        ...s,
        chatUi: {
          ...s.chatUi,
          archivedSectionCollapsed: true,
        },
      };
    }
    return state;
  },
};

type RootReducerState = ReturnType<typeof rootReducer>;

const persistConfig: Parameters<typeof persistReducer<RootReducerState>>[0] = {
  key: "root",
  version: 4,
  storage,
  whitelist: [
    "auth",
    "theme",
    "editor",
    "calendarUi",
    "projectsUi",
    "agentsUi",
    "chatUi",
    "recording",
    "callPreferences",
  ],
  transforms: [
    authSecurityTransform,
    calendarUiTransform,
    projectsUiTransform,
    agentsUiTransform,
    recordingTransform,
  ],
  migrate: createMigrate(migrations, { debug: false }),
};

const persistedReducer = persistReducer<RootReducerState>(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }).concat(errorToastMiddleware, contentAccessMiddleware),
});

setStoreRef(store);

// Non-React date utils read the zone and week start through their module
// getters; keep both in sync with the stored preference.
let lastPreferredTimeZone: string | null | undefined;
let lastWeekStart: string | null | undefined;
store.subscribe(() => {
  const appearance = store.getState().settings.effectiveSettings?.appearance;
  const tz = appearance?.timezone ?? null;
  if (tz !== lastPreferredTimeZone) {
    lastPreferredTimeZone = tz;
    setPreferredTimeZone(tz);
  }
  const weekStart = appearance?.weekStart ?? null;
  if (weekStart !== lastWeekStart) {
    lastWeekStart = weekStart;
    setPreferredWeekStart(weekStart);
  }
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof persistedReducer>;
export type AppDispatch = typeof store.dispatch;
