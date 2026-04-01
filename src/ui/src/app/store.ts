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
import { sharingReducer } from '@/features/sharing/store/sharingSlice';
import { adminReducer } from '@/features/admin/store/adminSlice';
import { setStoreRef } from '@/app/storeRef';
import { calendarReducer, calendarUiReducer } from '@/features/calendar/store';
import { zenModeReducer } from '@/app/zenModeSlice';
import { filesReducer, filesTreeReducer, uploadReducer, savedFiltersReducer, viewerReducer } from '@/features/files';
import { imageEditorReducer } from '@/features/files/store/imageEditorSlice';
import { notificationsReducer } from '@/features/notifications/store/notificationsSlice';
import { sessionsReducer } from '@/features/settings/store/sessionsSlice';
import { commentsReducer } from '@/features/comments/store/commentsSlice';
import { projectsReducer } from '@/features/projects/store/projectsSlice';
import { projectsUiReducer } from '@/features/projects/store/projectsUiSlice';
import { agentsUiReducer } from '@/features/agents/store/agentsUiSlice';
import { agentsReducer } from '@/features/agents/store/agentsSlice';
import { agentSessionsReducer } from '@/features/agents/store/agentSessionsSlice';
import { agentMessagesReducer } from '@/features/agents/store/agentMessagesSlice';
import { agentSkillsReducer } from '@/features/agents/store/agentSkillsSlice';
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

/**
 * Security transform: Remove access token from persistence.
 *
 * Access tokens are stored in memory only to reduce XSS attack surface.
 * On page reload, the app uses the refresh token to get a new access token.
 * This is an industry-standard security practice.
 */
const authSecurityTransform = createTransform(
  // Transform state before persisting (outbound)
  (inboundState: AuthState) => ({
    ...inboundState,
    accessToken: null, // Never persist access token
  }),
  // Transform state when rehydrating (inbound)
  (outboundState: AuthState) => ({
    ...outboundState,
    accessToken: null, // Ensure no stale access token
    isAuthenticated: false, // Will be set true after refresh
  }),
  { whitelist: ['auth'] }
);

/**
 * Calendar UI transform: Reset currentDate to today on rehydration.
 *
 * Users expect to see today's date when opening the calendar, not the
 * last date they were viewing from a previous session. Other UI preferences
 * like viewMode, sidebar settings, etc. are still preserved.
 */
const calendarUiTransform = createTransform(
  // Transform state before persisting (outbound) - keep as is
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // Transform state when rehydrating (inbound) - reset currentDate to today
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    currentDate: new Date().toISOString().split('T')[0], // Reset to today (YYYY-MM-DD)
  }),
  { whitelist: ['calendarUi'] }
);

/**
 * Projects UI transform: Reset transient state on rehydration.
 *
 * Preserves layout preferences (panel open/close, widths, viewMode, scope,
 * columnWidths) but resets transient state that should not survive a page
 * refresh (selections, modals, drag/editing, undo/redo).
 */
const projectsUiTransform = createTransform(
  // Transform state before persisting (outbound) - keep as is
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (inboundState: any) => inboundState,
  // Transform state when rehydrating (inbound) - reset transient state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outboundState: any) => ({
    ...outboundState,
    // Reset selections
    selectedTaskId: null,
    selectedTaskIds: [],
    isMultiSelectMode: false,
    // Reset modals
    isCreateProjectModalOpen: false,
    editProjectId: null,
    isCreateTaskModalOpen: false,
    isFieldPickerOpen: false,
    isViewConfigOpen: false,
    editingFieldId: null,
    // Reset transient interaction state
    dragState: null,
    editingCell: null,
    focusedCell: null,
    searchQuery: '',
    // Reset undo/redo (not meaningful across sessions)
    undoStack: [],
    redoStack: [],
    // Reset autosave (stale across sessions)
    autosave: { isSaving: {}, lastSaved: {}, hasChanges: {} },
  }),
  { whitelist: ['projectsUi'] }
);

/**
 * Agents UI transform: Reset transient state on rehydration.
 *
 * Preserves layout preferences (activeTab, sidebarCollapsed, agentsSidebarCollapsed,
 * agentsPanel) but resets transient state (selections, messages, search).
 */
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
  sharing: sharingReducer,
  admin: adminReducer,
  calendar: calendarReducer,
  calendarUi: calendarUiReducer,
  projects: projectsReducer,
  projectsUi: projectsUiReducer,
  agentsUi: agentsUiReducer,
  agents: agentsReducer,
  agentSessions: agentSessionsReducer,
  agentMessages: agentMessagesReducer,
  agentSkills: agentSkillsReducer,
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
  imageEditor: imageEditorReducer,
  notifications: notificationsReducer,
  presence: presenceReducer,
  sessions: sessionsReducer,
  comments: commentsReducer,
  chatChannels: chatChannelsReducer,
  chatMessages: chatMessagesReducer,
  chatThreads: chatThreadsReducer,
  chatUi: chatUiReducer,
});

// Migrations to handle state shape changes across versions
const migrations: MigrationManifest = {
  // Version 2: Migrate from currentTheme (string) to themeMode ('system' | 'light' | 'dark')
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
  // Version 3: Security - Remove access token from persistence
  // Access tokens are now stored in memory only to reduce XSS attack surface
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

// Type the persisted reducer properly - during rehydration state is never truly undefined
// because each slice has an initialState that's used as fallback
type RootReducerState = ReturnType<typeof rootReducer>;

const persistConfig: Parameters<typeof persistReducer<RootReducerState>>[0] = {
  key: 'root',
  version: 3, // Bumped to trigger security migration (access token removal)
  storage,
  whitelist: ['auth', 'theme', 'editor', 'calendarUi', 'projectsUi', 'agentsUi', 'chatUi'],
  transforms: [authSecurityTransform, calendarUiTransform, projectsUiTransform, agentsUiTransform],
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

// Initialize storeRef for modules that need store access without direct import
// This breaks the circular dependency: api.ts -> store.ts -> authSlice.ts
setStoreRef(store);

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
