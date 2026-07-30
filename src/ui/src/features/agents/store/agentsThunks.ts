import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Dispatch } from '@reduxjs/toolkit';
import { agentsApi } from '@/features/agents/api/agentsApi';
import type { RootState } from '@/app/store';
import type { AgentInfo } from '@uniffy/proto/agents/v1/agents_pb';
import { bulkUpsertTags, tagToPlain } from '@/features/tags';

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
    modelParams: agent.modelParams,
    imageParams: agent.imageParams,
    imageStylePrompt: agent.imageStylePrompt,
    primaryProviderKeyId: agent.primaryProviderKeyId || "",
    imageProviderKeyId: agent.imageProviderKeyId || "",
    tagIds: agent.tags.map((t) => t.id),
    isDeleted: agent.isDeleted,
    deletedAt: timestampToPlain(agent.deletedAt),
    createdAt: timestampToPlain(agent.createdAt),
    updatedAt: timestampToPlain(agent.updatedAt),
});

const hydrateAgentTags = (dispatch: Dispatch, agents: AgentInfo[]): void => {
    const tags = agents.flatMap((a) => a.tags.map(tagToPlain));
    if (tags.length) {
        dispatch(bulkUpsertTags(tags));
    }
};

export type SerializedAgent = ReturnType<typeof agentToPlain>;

export const fetchAgents = createAsyncThunk<
    SerializedAgent[],
    { accessMode?: number; groupId?: string } | void,
    { state: RootState; rejectValue: string }
>('agents/fetchAgents', async (params, { getState, dispatch, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.listAgents({
            organizationId,
            accessMode: params?.accessMode,
            groupId: params?.groupId,
        });
        hydrateAgentTags(dispatch, response.agents);
        return response.agents.map(agentToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch agents');
    }
});

/** The builder's deleted group. Server refuses this to non-builders. */
export const fetchDeletedAgents = createAsyncThunk<
    SerializedAgent[],
    void,
    { state: RootState; rejectValue: string }
>('agents/fetchDeletedAgents', async (_, { getState, dispatch, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.listAgents({ organizationId, deletedOnly: true });
        hydrateAgentTags(dispatch, response.agents);
        return response.agents.map(agentToPlain);
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to fetch deleted agents',
        );
    }
});

export const createAgent = createAsyncThunk<
    SerializedAgent,
    {
        name: string;
        primaryModel?: string;
        soulPrompt?: string;
        avatarEmoji?: string;
        enabledSkills?: string[];
        accessMode?: number;
        baselineRole?: number;
        groupIds?: string[];
        imageModel?: string;
        primaryProviderKeyId?: string;
        imageProviderKeyId?: string;
        tagIds?: string[];
        modelParams?: string;
        imageParams?: string;
        imageStylePrompt?: string;
    },
    { state: RootState; rejectValue: string }
>('agents/createAgent', async (params, { getState, dispatch, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.createAgent({
            organizationId,
            name: params.name,
            primaryModel: params.primaryModel,
            soulPrompt: params.soulPrompt,
            avatarEmoji: params.avatarEmoji,
            enabledSkills: params.enabledSkills ?? [],
            accessMode: params.accessMode,
            baselineRole: params.baselineRole,
            groupIds: params.groupIds ?? [],
            imageModel: params.imageModel,
            primaryProviderKeyId: params.primaryProviderKeyId,
            imageProviderKeyId: params.imageProviderKeyId,
            tagIds: params.tagIds ?? [],
            modelParams: params.modelParams,
            imageParams: params.imageParams,
            imageStylePrompt: params.imageStylePrompt,
        });
        if (!response.agent) throw new Error('No agent in response');
        hydrateAgentTags(dispatch, [response.agent]);
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
        imageModel?: string;
        primaryProviderKeyId?: string;
        imageProviderKeyId?: string;
        // Replace the agent's manual tag set; empty array clears tags; omit to leave untouched.
        tagIds?: string[];
        // Replaces the stored params object wholesale; "{}" resets to provider defaults.
        modelParams?: string;
        // Same contract for the image-generation knobs.
        imageParams?: string;
        imageStylePrompt?: string;
    },
    { state: RootState; rejectValue: string }
>('agents/updateAgent', async (params, { getState, dispatch, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = getOrganizationId(state);
        const { agentId, tagIds, ...fields } = params;
        // Proto3 repeated fields cannot distinguish unset from empty, so resend the current
        // Redux value for every repeated field; caller-provided values override.
        const current = state.agents.agents[agentId];
        const response = await agentsApi.updateAgent({
            organizationId,
            agentId,
            ...fields,
            enabledTools: fields.enabledTools ?? current?.enabledTools ?? [],
            enabledSkills: fields.enabledSkills ?? current?.enabledSkills ?? [],
            fallbackModels: fields.fallbackModels ?? current?.fallbackModels ?? [],
            tagIds: tagIds !== undefined ? { ids: tagIds } : undefined,
        });
        if (!response.agent) throw new Error('No agent in response');
        hydrateAgentTags(dispatch, [response.agent]);
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
            modelParams:
                source.modelParams && source.modelParams !== '{}' ? source.modelParams : undefined,
            imageParams:
                source.imageParams && source.imageParams !== '{}' ? source.imageParams : undefined,
            imageStylePrompt: source.imageStylePrompt || undefined,
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

export const restoreAgent = createAsyncThunk<
    SerializedAgent,
    string,
    { state: RootState; rejectValue: string }
>('agents/restoreAgent', async (agentId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await agentsApi.restoreAgent({ organizationId, agentId });
        if (!response.agent) throw new Error('No agent in response');
        return agentToPlain(response.agent);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to restore agent');
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
