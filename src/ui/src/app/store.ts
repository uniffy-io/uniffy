import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER, createMigrate, createTransform } from 'redux-persist';
import type { PersistedState, MigrationManifest } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import { authReducer } from '@/features/auth/store/authSlice';
import type { AuthState } from '@/features/auth/store/authSlice';
import { bookmarksReducer } from '@/features/bookmarks/store/bookmarksSlice';
import { themeReducer } from '@/config/theme/themeSlice';
import { notesReducer } from '@/features/notes/store/notesSlice';
import { notesTreeReducer } from '@/features/notes/store/notesTreeSlice';
import { editorReducer } from '@/features/notes/store/editorSlice';
import { settingsReducer } from '@/features/settings/store/settingsSlice';
import { permissionsReducer } from '@/features/permissions';
import { adminReducer } from '@/features/admin/store/adminSlice';
import { agentsGovernanceReducer } from '@/features/admin/store/agentsGovernanceSlice';
import { setStoreRef } from '@/app/storeRef';
import { calendarReducer, calendarUiReducer } from '@/features/calendar/store';
import { zenModeReducer } from '@/app/zenModeSlice';
import { filesReducer, filesTreeReducer, uploadReducer, savedFiltersReducer, viewerReducer, trashReducer } from '@/features/files';
import { imageEditorReducer } from '@/features/files/store/imageEditorSlice';
import { notificationsReducer } from '@/features/notifications/store/notificationsSlice';
import { notificationsPageReducer } from '@/features/notifications/store/notificationsPageSlice';
import { sessionsReducer } from '@/features/settings/store/sessionsSlice';
import { commentsReducer } from '@/features/comments/store/commentsSlice';
import { projectsReducer } from '@/features/projects/store/projectsSlice';
import { projectsUiReducer } from '@/features/projects/store/projectsUiSlice';
import { loadColumnWidths, loadHiddenColumns } from '@/features/projects/utils/tableColumnStorage';
import { agentsUiReducer } from '@/features/agents/store/agentsUiSlice';
import { agentsReducer } from '@/features/agents/store/agentsSlice';
import { agentSessionsReducer } from '@/features/agents/store/agentSessionsSlice';
import { agentMessagesReducer } from '@/features/agents/store/agentMessagesSlice';
import { agentSkillsReducer } from '@/features/agents/store/agentSkillsSlice';
import { agentRunnableSkillsReducer } from '@/features/agents/store/agentRunnableSkillsSlice';
import { agentSkillDraftsReducer } from '@/features/agents/store/agentSkillDraftsSlice';
import { agentSkillVersionsReducer } from '@/features/agents/store/agentSkillVersionsSlice';
import { agentSkillMetricsReducer } from '@/features/agents/store/agentSkillMetricsSlice';
import { agentPromptsReducer } from '@/features/agents/store/agentPromptsSlice';
import { agentProvidersReducer } from '@/features/agents/store/agentProvidersSlice';
import { agentUsageReducer } from '@/features/agents/store/agentUsageSlice';
import { agentCronReducer } from '@/features/agents/store/agentCronSlice';
import { agentMemoriesReducer } from '@/features/agents/store/agentMemoriesSlice';
import { errorToastMiddleware } from '@/app/errorToastMiddleware';
import { presenceReducer } from '@/features/presence/store/presenceSlice';
import { sprintsReducer } from '@/features/projects/store/sprintsSlice';
import { roomsReducer } from '@/features/rooms/store/roomsSlice';
import { chatChannelsReducer } from '@/features/chat/store/chatChannelsSlice';
import { chatMessagesReducer } from '@/features/chat/store/chatMessagesSlice';
import { chatThreadsReducer } from '@/features/chat/store/chatThreadsSlice';
import { chatUiReducer } from '@/features/chat/store/chatUiSlice';
import { tagsReducer } from '@/features/tags/store/tagsSlice';
import { recordingReducer } from '@/features/recording';
import { callsReducer } from '@/features/calls/store/callsSlice';
import { callPreferencesReducer } from '@/features/calls/store/callPreferencesSlice';

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
  { whitelist: ['auth'] }
);

/** Calendar opens to today, not the last viewed date; other UI prefs survive. */
const calendarUiTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    currentDate: new Date().toISOString().split('T')[0],
  }),
  { whitelist: ['calendarUi'] }
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
    isMultiSelectMode: false,
    isCreateProjectModalOpen: false,
    editProjectId: null,
    isCreateTaskModalOpen: false,
    isFieldPickerOpen: false,
    isViewConfigOpen: false,
    editingFieldId: null,
    dragState: null,
    editingCell: null,
    focusedCell: null,
    searchQuery: '',
    undoStack: [],
    redoStack: [],
    autosave: { isSaving: {}, lastSaved: {}, hasChanges: {} },
  }),
  { whitelist: ['projectsUi'] }
);

/** Force `idle` on rehydrate - MediaRecorder/MediaStream can't survive a reload. Picker prefs persist. */
const recordingTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    state: 'idle',
    network: 'online',
    auth: 'ok',
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
  { whitelist: ['recording'] },
);

/** Preserve layout prefs; reset selections, messages, search on rehydrate. */
const agentsUiTransform = createTransform(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    selectedAgentId: null,
    chatMessage: '',
    sidebarContent: null,
    skillSearch: '',
  }),
  { whitelist: ['agentsUi'] }
);

const rootReducer = combineReducers({
  auth: authReducer,
  bookmarks: bookmarksReducer,
  theme: themeReducer,
  notes: notesReducer,
  notesTree: notesTreeReducer,
  editor: editorReducer,
  settings: settingsReducer,
  permissions: permissionsReducer,
  admin: adminReducer,
  agentsGovernance: agentsGovernanceReducer,
  calendar: calendarReducer,
  calendarUi: calendarUiReducer,
  projects: projectsReducer,
  projectsUi: projectsUiReducer,
  agentsUi: agentsUiReducer,
  agents: agentsReducer,
  agentSessions: agentSessionsReducer,
  agentMessages: agentMessagesReducer,
  agentSkills: agentSkillsReducer,
  agentRunnableSkills: agentRunnableSkillsReducer,
  agentSkillDrafts: agentSkillDraftsReducer,
  agentSkillVersions: agentSkillVersionsReducer,
  agentSkillMetrics: agentSkillMetricsReducer,
  agentPrompts: agentPromptsReducer,
  agentProviders: agentProvidersReducer,
  agentUsage: agentUsageReducer,
  agentCron: agentCronReducer,
  agentMemories: agentMemoriesReducer,
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
  tags: tagsReducer,
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
      let newMode: 'system' | 'light' | 'dark' = 'system';
      if (oldTheme === 'dark') {
        newMode = 'dark';
      } else if (oldTheme === 'default' || oldTheme === 'light') {
        newMode = 'light';
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
};

type RootReducerState = ReturnType<typeof rootReducer>;

const persistConfig: Parameters<typeof persistReducer<RootReducerState>>[0] = {
  key: 'root',
  version: 3,
  storage,
  whitelist: ['auth', 'theme', 'editor', 'calendarUi', 'projectsUi', 'agentsUi', 'chatUi', 'recording', 'callPreferences'],
  transforms: [authSecurityTransform, calendarUiTransform, projectsUiTransform, agentsUiTransform, recordingTransform],
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
    }).concat(errorToastMiddleware),
});

setStoreRef(store);

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
