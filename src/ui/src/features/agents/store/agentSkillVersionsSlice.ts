import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import {
  fetchSkillVersions,
  setMainSkillVersion,
  revertSkill,
  type SerializedSkillVersion,
} from "@/features/agents/store/agentSkillVersionsThunks";

interface SkillVersionsEntry {
  versions: SerializedSkillVersion[];
  activeVersionNumber: number;
  activeVersionPinned: boolean;
  latestVersionNumber: number;
  loading: boolean;
}

interface AgentSkillVersionsState {
  bySkill: Record<string, SkillVersionsEntry>;
}

const initialState: AgentSkillVersionsState = {
  bySkill: {},
};

const EMPTY_VERSIONS: SerializedSkillVersion[] = [];

function ensureEntry(state: AgentSkillVersionsState, skillId: string): SkillVersionsEntry {
  let entry = state.bySkill[skillId];
  if (!entry) {
    entry = {
      versions: [],
      activeVersionNumber: 0,
      activeVersionPinned: false,
      latestVersionNumber: 0,
      loading: false,
    };
    state.bySkill[skillId] = entry;
  }
  return entry;
}

export const agentSkillVersionsSlice = createSlice({
  name: "agentSkillVersions",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSkillVersions.pending, (state, action) => {
        ensureEntry(state, action.meta.arg).loading = true;
      })
      .addCase(fetchSkillVersions.fulfilled, (state, action) => {
        state.bySkill[action.payload.skillId] = {
          versions: action.payload.versions,
          activeVersionNumber: action.payload.activeVersionNumber,
          activeVersionPinned: action.payload.activeVersionPinned,
          latestVersionNumber: action.payload.latestVersionNumber,
          loading: false,
        };
      })
      .addCase(fetchSkillVersions.rejected, (state, action) => {
        const entry = state.bySkill[action.meta.arg];
        if (entry) entry.loading = false;
      })
      .addCase(setMainSkillVersion.fulfilled, (state, action) => {
        const entry = state.bySkill[action.payload.skillId];
        if (!entry) return;
        entry.activeVersionNumber = action.payload.skill.activeVersionNumber;
        entry.activeVersionPinned = action.payload.skill.activeVersionPinned;
      })
      .addCase(revertSkill.fulfilled, (state, action) => {
        const entry = ensureEntry(state, action.payload.skillId);
        entry.versions = [action.payload.version, ...entry.versions];
        entry.latestVersionNumber = action.payload.skill.latestVersionNumber;
        entry.activeVersionNumber = action.payload.skill.activeVersionNumber;
        entry.activeVersionPinned = action.payload.skill.activeVersionPinned;
      });
  },
});

export const selectSkillVersionsEntry =
  (skillId: string) =>
  (state: RootState): SkillVersionsEntry | undefined =>
    state.agentSkillVersions.bySkill[skillId];

export const selectSkillVersions =
  (skillId: string) =>
  (state: RootState): SerializedSkillVersion[] =>
    state.agentSkillVersions.bySkill[skillId]?.versions ?? EMPTY_VERSIONS;

export const agentSkillVersionsReducer = agentSkillVersionsSlice.reducer;
