import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { persistStore, persistReducer, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import authReducer from '@/features/auth/store/authSlice';
import themeReducer from '@/theme/themeSlice';
import notesReducer from '@/features/notes/store/notesSlice';
import notesTreeReducer from '@/features/notes/store/notesTreeSlice';
import editorReducer from '@/features/notes/store/editorSlice';

const rootReducer = combineReducers({
  auth: authReducer,
  theme: themeReducer,
  notes: notesReducer,
  notesTree: notesTreeReducer,
  editor: editorReducer,
});

const persistConfig = {
  key: 'root',
  version: 1,
  storage,
  whitelist: ['auth', 'theme', 'editor'], // Persist auth, theme, and editor settings
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});

export const persistor = persistStore(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
