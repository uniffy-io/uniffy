import { createAsyncThunk } from '@reduxjs/toolkit';
import { agentsApi } from '@/features/agents/api/agentsApi';
import type { RootState } from '@/app/store';
import type { AgentInfo } from '@uniffy/proto/agents/v1/agents_pb';

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

export const agentToPlain = (agent: AgentInfo) => ({
    id: agent.id,
    organizationId: agent.organizationId,
    ownerId: agent.ownerId,
    name: agent.name,
    soulPrompt: agent.soulPrompt,
    primaryModel: agent.primaryModel,
    fallbackModels: [...agent.fallbackModels],
    enabledTools: [...agent.enabledTools],
    avatarEmoji: agent.avatarEmoji,
    avatarKey: agent.avatarKey || "",
    themeColor: agent.themeColor,
    isDefault: agent.isDefault,
    enabledSkills: [...agent.enabledSkills],
    accessMode: agent.accessMode,
    baselineRole: agent.baselineRole,
    userRole: agent.userRole,
    imageModel: agent.imageModel,
    promptId: agent.promptId || "",
    primaryProviderKeyId: agent.primaryProviderKeyId || "",
    imageProviderKeyId: agent.imageProviderKeyId || "",
    createdAt: timestampToPlain(agent.createdAt),
    updatedAt: timestampToPlain(agent.updatedAt),
});

export type SerializedAgent = ReturnType<typeof agentToPlain>;

export const fetchAgents = createAsyncThunk<
    SerializedAgent[],
    { accessMode?: number; personalOnly?: boolean; groupId?: string } | void,
    { state: RootState; rejectValue: string }
>('agents/fetchAgents', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.listAgents({
            organizationId,
            accessMode: params?.accessMode,
            personalOnly: params?.personalOnly,
            groupId: params?.groupId,
        });
        return response.agents.map(agentToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch agents');
    }
});

export const createAgent = createAsyncThunk<
    SerializedAgent,
    {
        name: string;
        primaryModel?: string;
        soulPrompt?: string;
        accessMode?: number;
        baselineRole?: number;
        groupIds?: string[];
        imageModel?: string;
        primaryProviderKeyId?: string;
        imageProviderKeyId?: string;
        promptId?: string;
    },
    { state: RootState; rejectValue: string }
>('agents/createAgent', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.createAgent({
            organizationId,
            name: params.name,
            primaryModel: params.primaryModel,
            soulPrompt: params.soulPrompt,
            accessMode: params.accessMode,
            baselineRole: params.baselineRole,
            groupIds: params.groupIds ?? [],
            imageModel: params.imageModel,
            primaryProviderKeyId: params.primaryProviderKeyId,
            imageProviderKeyId: params.imageProviderKeyId,
            promptId: params.promptId,
        });
        if (!response.agent) throw new Error('No agent in response');
        return agentToPlain(response.agent);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create agent');
    }
});

export const updateAgent = createAsyncThunk<
    SerializedAgent,
    {
        agentId: string;
        name?: string;
        primaryModel?: string;
        fallbackModels?: string[];
        enabledTools?: string[];
        enabledSkills?: string[];
        soulPrompt?: string;
        avatarEmoji?: string;
        isDefault?: boolean;
        accessMode?: number;
        baselineRole?: number;
        groupIds?: string[];
        imageModel?: string;
        primaryProviderKeyId?: string;
        imageProviderKeyId?: string;
        promptId?: string;
        clearPrompt?: boolean;
    },
    { state: RootState; rejectValue: string }
>('agents/updateAgent', async (params, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = getOrganizationId(state);
        const { agentId, ...fields } = params;
        // Proto3 repeated fields cannot distinguish "sent empty" from "not
        // sent" (both deserialise to []). To let the backend always apply the
        // correct value, we send the current Redux value for every repeated
        // field, overridden by whatever the caller explicitly provided.
        const current = state.agents.agents[agentId];
        const response = await agentsApi.updateAgent({
            organizationId,
            agentId,
            ...fields,
            enabledTools: fields.enabledTools ?? current?.enabledTools ?? [],
            enabledSkills: fields.enabledSkills ?? current?.enabledSkills ?? [],
            fallbackModels: fields.fallbackModels ?? current?.fallbackModels ?? [],
        });
        if (!response.agent) throw new Error('No agent in response');
        return agentToPlain(response.agent);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update agent');
    }
});

export const cloneAgent = createAsyncThunk<
    SerializedAgent,
    string,
    { state: RootState; rejectValue: string }
>('agents/cloneAgent', async (agentId, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = getOrganizationId(state);
        const source = state.agents.agents[agentId];
        if (!source) throw new Error('Agent not found');
        const createResponse = await agentsApi.createAgent({
            organizationId,
            name: `${source.name} (Copy)`,
            soulPrompt: source.soulPrompt,
            primaryModel: source.primaryModel,
            fallbackModels: source.fallbackModels,
            avatarEmoji: source.avatarEmoji,
            themeColor: source.themeColor,
            enabledSkills: source.enabledSkills,
            accessMode: source.accessMode,
            baselineRole: source.baselineRole,
            imageModel: source.imageModel,
            primaryProviderKeyId: source.primaryProviderKeyId || undefined,
            imageProviderKeyId: source.imageProviderKeyId || undefined,
        });
        if (!createResponse.agent) throw new Error('No agent in response');
        if (source.enabledTools.length > 0) {
            const updateResponse = await agentsApi.updateAgent({
                organizationId,
                agentId: createResponse.agent.id,
                enabledTools: source.enabledTools,
                enabledSkills: source.enabledSkills,
                fallbackModels: source.fallbackModels,
            });
            if (!updateResponse.agent) throw new Error('No agent in response');
            return agentToPlain(updateResponse.agent);
        }
        return agentToPlain(createResponse.agent);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to clone agent');
    }
});

export const deleteAgent = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agents/deleteAgent', async (agentId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await agentsApi.deleteAgent({ organizationId, agentId });
        return agentId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete agent');
    }
});

export const uploadAgentAvatar = createAsyncThunk<
    SerializedAgent,
    { agentId: string; imageData: Uint8Array<ArrayBuffer>; filename: string },
    { state: RootState; rejectValue: string }
>('agents/uploadAgentAvatar', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.uploadAgentAvatar({
            organizationId,
            agentId: params.agentId,
            imageData: params.imageData,
            filename: params.filename,
        });
        if (!response.agent) throw new Error('No agent in response');
        return agentToPlain(response.agent);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to upload avatar');
    }
});

export const previewSystemPrompt = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agents/previewSystemPrompt', async (agentId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.previewSystemPrompt({
            organizationId,
            agentId,
        });
        return response.systemPrompt;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to preview system prompt');
    }
});

export const deleteAgentAvatar = createAsyncThunk<
    SerializedAgent,
    string,
    { state: RootState; rejectValue: string }
>('agents/deleteAgentAvatar', async (agentId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.deleteAgentAvatar({
            organizationId,
            agentId,
        });
        if (!response.agent) throw new Error('No agent in response');
        return agentToPlain(response.agent);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete avatar');
    }
});
