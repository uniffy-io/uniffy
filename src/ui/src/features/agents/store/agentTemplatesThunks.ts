import { createAsyncThunk } from '@reduxjs/toolkit';
import { agentsApi } from '@/features/agents/api/agentsApi';
import type { RootState } from '@/app/store';
import type { AgentTemplate } from '@uniffy/proto/agents/v1/agents_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

export const templateToPlain = (template: AgentTemplate) => ({
    key: template.key,
    name: template.name,
    emoji: template.emoji,
    description: template.description,
    soulPrompt: template.soulPrompt,
    enabledTools: [...template.enabledTools],
    enabledSkillIds: [...template.enabledSkillIds],
});

export type SerializedAgentTemplate = ReturnType<typeof templateToPlain>;

export const fetchAgentTemplates = createAsyncThunk<
    SerializedAgentTemplate[],
    void,
    { state: RootState; rejectValue: string }
>(
    'agentTemplates/fetch',
    async (_, { getState, rejectWithValue }) => {
        try {
            const organizationId = getOrganizationId(getState());
            const response = await agentsApi.listAgentTemplates({ organizationId });
            return response.templates.map(templateToPlain);
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to fetch agent templates',
            );
        }
    },
    {
        // Shipped catalog, identical for every org: fetch it once so the create
        // gallery renders filled instead of empty-then-populated.
        condition: (_, { getState }) => {
            const state = getState().agentTemplates;
            return !state.loaded && !state.loading;
        },
    },
);
