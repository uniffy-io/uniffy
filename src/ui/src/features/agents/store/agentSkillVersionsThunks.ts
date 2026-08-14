import { createAsyncThunk } from "@reduxjs/toolkit";
import { skillsApi } from "@/features/agents/api/skillsApi";
import { skillToPlain, type SerializedSkill } from "@/features/agents/store/agentSkillsThunks";
import type { RootState } from "@/app/store";
import type { SkillVersion } from "@uniffy/proto/agents/v1/skills_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds,
    nanos: typeof ts.nanos === "bigint" ? Number(ts.nanos) : ts.nanos,
  };
};

export const skillVersionToPlain = (version: SkillVersion) => ({
  id: version.id,
  skillId: version.skillId,
  versionNumber: version.versionNumber,
  name: version.name,
  displayName: version.displayName,
  description: version.description,
  content: version.content,
  whenToUse: version.whenToUse,
  requiresTools: [...version.requiresTools],
  requiresContext: [...version.requiresContext],
  authorId: version.authorId ?? undefined,
  authorKind: version.authorKind,
  changeSummary: version.changeSummary,
  parentVersionId: version.parentVersionId ?? undefined,
  createdAt: timestampToPlain(version.createdAt),
});

export type SerializedSkillVersion = ReturnType<typeof skillVersionToPlain>;

export interface SkillVersionsResult {
  skillId: string;
  versions: SerializedSkillVersion[];
  activeVersionNumber: number;
  activeVersionPinned: boolean;
  latestVersionNumber: number;
}

export const fetchSkillVersions = createAsyncThunk<
  SkillVersionsResult,
  string,
  { state: RootState; rejectValue: string }
>("agentSkillVersions/fetch", async (skillId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await skillsApi.listSkillVersions({ organizationId, skillId });
    return {
      skillId,
      versions: response.versions.map(skillVersionToPlain),
      activeVersionNumber: response.activeVersionNumber,
      activeVersionPinned: response.activeVersionPinned,
      latestVersionNumber: response.latestVersionNumber,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch versions");
  }
});

export const setMainSkillVersion = createAsyncThunk<
  { skillId: string; skill: SerializedSkill },
  { skillId: string; versionNumber?: number; followLatest: boolean },
  { state: RootState; rejectValue: string }
>(
  "agentSkillVersions/setMain",
  async ({ skillId, versionNumber, followLatest }, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await skillsApi.setMainSkillVersion({
        organizationId,
        skillId,
        versionNumber,
        followLatest,
      });
      if (!response.skill) throw new Error("No skill in response");
      return { skillId, skill: skillToPlain(response.skill) };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to set main version");
    }
  },
);

export const revertSkill = createAsyncThunk<
  { skillId: string; skill: SerializedSkill; version: SerializedSkillVersion },
  { skillId: string; versionNumber: number },
  { state: RootState; rejectValue: string }
>(
  "agentSkillVersions/revert",
  async ({ skillId, versionNumber }, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await skillsApi.revertSkill({
        organizationId,
        skillId,
        versionNumber,
      });
      if (!response.skill || !response.version) throw new Error("Incomplete revert response");
      return {
        skillId,
        skill: skillToPlain(response.skill),
        version: skillVersionToPlain(response.version),
      };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to revert skill");
    }
  },
);
