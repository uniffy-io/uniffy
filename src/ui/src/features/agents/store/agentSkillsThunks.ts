import { createAsyncThunk } from '@reduxjs/toolkit';
import { skillsApi } from '@/features/agents/api/skillsApi';
import type { RootState } from '@/app/store';
import type { SkillInfo } from '@uniffy/proto/agents/v1/skills_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
    if (!ts) return undefined;
    return {
        seconds: typeof ts.seconds === 'bigint' ? Number(ts.seconds) : ts.seconds,
        nanos: typeof ts.nanos === 'bigint' ? Number(ts.nanos) : ts.nanos,
    };
};

export const skillToPlain = (skill: SkillInfo) => ({
    id: skill.id,
    organizationId: skill.organizationId,
    name: skill.name,
    displayName: skill.displayName,
    description: skill.description,
    content: skill.content,
    whenToUse: skill.whenToUse,
    requiresTools: [...skill.requiresTools],
    requiresContext: [...skill.requiresContext],
    source: skill.source,
    alwaysActive: skill.alwaysActive,
    latestVersionNumber: skill.latestVersionNumber,
    activeVersionNumber: skill.activeVersionNumber,
    activeVersionPinned: skill.activeVersionPinned,
    createdAt: timestampToPlain(skill.createdAt),
    updatedAt: timestampToPlain(skill.updatedAt),
});

export type SerializedSkill = ReturnType<typeof skillToPlain>;

export const fetchSkills = createAsyncThunk<
    SerializedSkill[],
    void,
    { state: RootState; rejectValue: string }
>('agentSkills/fetchSkills', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await skillsApi.listSkills({ organizationId });
        return response.skills.map(skillToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch skills');
    }
});

export const createSkill = createAsyncThunk<
    SerializedSkill,
    { name: string; displayName: string; description: string; content: string },
    { state: RootState; rejectValue: string }
>('agentSkills/createSkill', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await skillsApi.createSkill({
            organizationId,
            ...params,
        });
        if (!response.skill) throw new Error('No skill in response');
        return skillToPlain(response.skill);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create skill');
    }
});

export const updateSkill = createAsyncThunk<
    SerializedSkill,
    {
        skillId: string;
        displayName?: string;
        description?: string;
        content?: string;
        whenToUse?: string;
        alwaysActive?: boolean;
    },
    { state: RootState; rejectValue: string }
>('agentSkills/updateSkill', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const { skillId, ...fields } = params;
        const response = await skillsApi.updateSkill({
            organizationId,
            skillId,
            ...fields,
        });
        if (!response.skill) throw new Error('No skill in response');
        return skillToPlain(response.skill);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update skill');
    }
});

export const deleteSkill = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agentSkills/deleteSkill', async (skillId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await skillsApi.deleteSkill({ organizationId, skillId });
        return skillId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete skill');
    }
});
