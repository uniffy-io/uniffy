import { createAsyncThunk } from '@reduxjs/toolkit';
import { skillsApi } from '@/features/agents/api/skillsApi';
import type { RootState } from '@/app/store';
import type { RunnableSkill } from '@uniffy/proto/agents/v1/skills_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

export const runnableSkillToPlain = (skill: RunnableSkill) => ({
    id: skill.id,
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    whenToUse: skill.whenToUse,
});

export type SerializedRunnableSkill = ReturnType<typeof runnableSkillToPlain>;

export const fetchRunnableSkills = createAsyncThunk<
    { agentId: string; skills: SerializedRunnableSkill[] },
    { agentId: string },
    { state: RootState; rejectValue: string }
>('agentRunnableSkills/fetch', async ({ agentId }, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await skillsApi.listRunnableSkills({ organizationId, agentId });
        return { agentId, skills: response.skills.map(runnableSkillToPlain) };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to fetch runnable skills',
        );
    }
});
