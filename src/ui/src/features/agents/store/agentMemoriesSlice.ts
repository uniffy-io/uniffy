import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { SerializedMemory } from "@/features/agents/store/agentMemoriesThunks";
import {
  fetchMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  setMemoryPinned,
  fetchMemorySharing,
  updateMemorySharing,
  memoryScopeKey,
} from "@/features/agents/store/agentMemoriesThunks";

export interface MemoryScopeState {
  memories: Record<string, SerializedMemory>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  totalCount: number;
}

export interface MemorySharingSliceState {
  useInSharedSpaces: boolean;
  orgAllows: boolean;
  loaded: boolean;
}

interface AgentMemoriesState {
  byScope: Record<string, MemoryScopeState>;
  sharing: MemorySharingSliceState;
}

const initialState: AgentMemoriesState = {
  byScope: {},
  sharing: { useInSharedSpaces: false, orgAllows: true, loaded: false },
};

const EMPTY_SCOPE_STATE: MemoryScopeState = {
  memories: {},
  loading: false,
  loaded: false,
  error: null,
  totalCount: 0,
};

const scopeState = (state: AgentMemoriesState, scopeKey: string): MemoryScopeState => {
  state.byScope[scopeKey] ??= {
    memories: {},
    loading: false,
    loaded: false,
    error: null,
    totalCount: 0,
  };
  return state.byScope[scopeKey];
};

export const agentMemoriesSlice = createSlice({
  name: "agentMemories",
  initialState,
  reducers: {
    clearAgentMemories: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMemories.pending, (state, action) => {
        const bucket = scopeState(state, memoryScopeKey(action.meta.arg));
        bucket.loading = true;
        bucket.error = null;
      })
      .addCase(fetchMemories.fulfilled, (state, action) => {
        const bucket = scopeState(state, action.payload.scopeKey);
        bucket.loading = false;
        bucket.loaded = true;
        bucket.memories = {};
        for (const memory of action.payload.memories) {
          bucket.memories[memory.id] = memory;
        }
        bucket.totalCount = action.payload.totalCount;
      })
      .addCase(fetchMemories.rejected, (state, action) => {
        const bucket = scopeState(state, memoryScopeKey(action.meta.arg));
        bucket.loading = false;
        bucket.error = action.payload ?? "Failed to fetch memories";
      })
      .addCase(createMemory.fulfilled, (state, action) => {
        const bucket = scopeState(state, action.payload.scopeKey);
        bucket.memories[action.payload.memory.id] = action.payload.memory;
        bucket.totalCount += 1;
      })
      .addCase(updateMemory.fulfilled, (state, action) => {
        const bucket = scopeState(state, action.payload.scopeKey);
        bucket.memories[action.payload.memory.id] = action.payload.memory;
      })
      .addCase(setMemoryPinned.fulfilled, (state, action) => {
        const bucket = scopeState(state, action.payload.scopeKey);
        bucket.memories[action.payload.memory.id] = action.payload.memory;
      })
      .addCase(deleteMemory.fulfilled, (state, action) => {
        const bucket = scopeState(state, action.payload.scopeKey);
        if (bucket.memories[action.payload.memoryId]) {
          delete bucket.memories[action.payload.memoryId];
          bucket.totalCount = Math.max(0, bucket.totalCount - 1);
        }
      })
      .addCase(fetchMemorySharing.fulfilled, (state, action) => {
        state.sharing = { ...action.payload, loaded: true };
      })
      .addCase(updateMemorySharing.fulfilled, (state, action) => {
        state.sharing = { ...action.payload, loaded: true };
      });
  },
});

export const { clearAgentMemories } = agentMemoriesSlice.actions;

export const selectMemoryScope =
  (scopeKey: string) =>
  (state: RootState): MemoryScopeState =>
    state.agentMemories.byScope[scopeKey] ?? EMPTY_SCOPE_STATE;

export const selectMemorySharing = (state: RootState): MemorySharingSliceState =>
  state.agentMemories.sharing;

export const agentMemoriesReducer = agentMemoriesSlice.reducer;
