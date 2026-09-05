import { createAsyncThunk } from "@reduxjs/toolkit";
import { skillsApi } from "@/features/agents/api/skillsApi";
import type { RootState } from "@/app/store";
import type { RunnableSkill } from "@uniffy/proto/agents/v1/skills_pb";

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
