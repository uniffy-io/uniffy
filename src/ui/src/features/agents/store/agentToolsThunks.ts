import { createAsyncThunk } from '@reduxjs/toolkit';
import { agentsApi } from '@/features/agents/api/agentsApi';
import { rememberToolLabels } from '@/features/agents/config/toolLabels';
import { setToolGroupOrder } from '@/features/agents/config/toolGroupVisuals';
import type { RootState } from '@/app/store';
import type { ToolInfo } from '@uniffy/proto/agents/v1/agents_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

export const toolToPlain = (tool: ToolInfo) => ({
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    group: tool.group,
    category: tool.category,
    destructive: tool.destructive,
    requiresConnection: tool.requiresConnection,
});

export type SerializedTool = ReturnType<typeof toolToPlain>;

export const fetchAgentTools = createAsyncThunk<
    SerializedTool[],
    void,
    { state: RootState; rejectValue: string }
>(
    'agentTools/fetch',
    async (_, { getState, rejectWithValue }) => {
        try {
            const organizationId = getOrganizationId(getState());
            const response = await agentsApi.listTools({ organizationId });
            const tools = response.tools.map(toolToPlain);
            // Labels and the group color ramp are read outside React (tool
            // pills in a streaming message), so they live in module state the
            // fetch fills rather than in the store.
            rememberToolLabels(tools);
            setToolGroupOrder([...new Set(tools.map((tool) => tool.group))]);
            return tools;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to fetch tools',
            );
        }
    },
    {
        // Shipped catalog, identical for every org: fetch it once per session.
        condition: (_, { getState }) => {
            const state = getState().agentTools;
            return !state.loaded && !state.loading;
        },
    },
);
