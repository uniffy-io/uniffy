import { createAsyncThunk } from '@reduxjs/toolkit';
import { promptsApi } from '@/features/agents/api/promptsApi';
import type { RootState } from '@/app/store';
import type { PromptInfo } from '@/gen/agents/v1/prompts_pb';
import { VisibilityScope } from '@/gen/common/v1/common_pb';

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

export const promptToPlain = (prompt: PromptInfo) => ({
    id: prompt.id,
    organizationId: prompt.organizationId,
    name: prompt.name,
    displayName: prompt.displayName,
    description: prompt.description,
    content: prompt.content,
    source: prompt.source,
    ownerId: prompt.ownerId,
    visibility: prompt.visibility,
    createdBy: prompt.createdBy,
    createdAt: timestampToPlain(prompt.createdAt),
    updatedAt: timestampToPlain(prompt.updatedAt),
});

export type SerializedPrompt = ReturnType<typeof promptToPlain>;

export const fetchPrompts = createAsyncThunk<
    SerializedPrompt[],
    void,
    { state: RootState; rejectValue: string }
>('agentPrompts/fetchPrompts', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await promptsApi.listPrompts({ organizationId });
        return response.prompts.map(promptToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch prompts');
    }
});

export const createPrompt = createAsyncThunk<
    SerializedPrompt,
    { displayName: string; description: string; content: string; visibility?: number },
    { state: RootState; rejectValue: string }
>('agentPrompts/createPrompt', async (params, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = getOrganizationId(state);
        const isPersonal = !params.visibility || params.visibility === VisibilityScope.PRIVATE;
        const ownerId = isPersonal ? state.auth.user?.id : undefined;
        const response = await promptsApi.createPrompt({
            organizationId,
            ...params,
            ownerId,
        });
        if (!response.prompt) throw new Error('No prompt in response');
        return promptToPlain(response.prompt);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create prompt');
    }
});

export const updatePrompt = createAsyncThunk<
    SerializedPrompt,
    { promptId: string; displayName?: string; description?: string; content?: string; name?: string; visibility?: number },
    { state: RootState; rejectValue: string }
>('agentPrompts/updatePrompt', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const { promptId, ...fields } = params;
        const response = await promptsApi.updatePrompt({
            organizationId,
            promptId,
            ...fields,
        });
        if (!response.prompt) throw new Error('No prompt in response');
        return promptToPlain(response.prompt);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update prompt');
    }
});

export const deletePrompt = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agentPrompts/deletePrompt', async (promptId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await promptsApi.deletePrompt({ organizationId, promptId });
        return promptId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete prompt');
    }
});
