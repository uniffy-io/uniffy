import { createAsyncThunk } from "@reduxjs/toolkit";
import { skillsApi } from "@/features/agents/api/skillsApi";
import type { RootState } from "@/app/store";
import type { RunnableSkill, SkillCompatibility } from "@uniffy/proto/agents/v1/skills_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

export const runnableSkillToPlain = (skill: RunnableSkill) => ({
  id: skill.id,
  name: skill.name,
  displayName: skill.displayName,
  description: skill.description,
});

export type SerializedRunnableSkill = ReturnType<typeof runnableSkillToPlain>;

export const skillCompatibilityToPlain = (skill: SkillCompatibility) => ({
  skillId: skill.skillId,
  versionId: skill.versionId,
  versionNumber: skill.versionNumber,
  missingTools: [...skill.missingTools],
  unsupportedSurfaces: [...skill.unsupportedSurfaces],
  unavailable: skill.unavailable,
  displayName: skill.displayName,
  retired: skill.retired,
});

export type SerializedSkillCompatibility = ReturnType<typeof skillCompatibilityToPlain>;
export interface SkillCompatibilityRequest {
  organizationId: string;
  agentId: string;
}

export const fetchSkillCompatibility = createAsyncThunk<
  SkillCompatibilityRequest & { skills: SerializedSkillCompatibility[] },
  SkillCompatibilityRequest,
  { state: RootState; rejectValue: string }
>("agentRunnableSkills/compatibility", async (params, { getState, rejectWithValue }) => {
  try {
    if (getOrganizationId(getState()) !== params.organizationId) {
      throw new Error("Organization changed");
    }
    const response = await skillsApi.getSkillCompatibility(params);
    return { ...params, skills: response.skills.map(skillCompatibilityToPlain) };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to check skill compatibility",
    );
  }
});

export interface RunnableSkillsRequest {
  organizationId: string;
  agentId: string;
  surface: "session" | "chat";
}

export const fetchRunnableSkills = createAsyncThunk<
  RunnableSkillsRequest & { skills: SerializedRunnableSkill[] },
  RunnableSkillsRequest,
  { state: RootState; rejectValue: string }
>("agentRunnableSkills/fetch", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    if (organizationId !== params.organizationId) throw new Error("Organization changed");
    const response = await skillsApi.listRunnableSkills(params);
    return { ...params, skills: response.skills.map(runnableSkillToPlain) };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch runnable skills",
    );
  }
});
