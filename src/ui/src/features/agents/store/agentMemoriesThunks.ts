import { createAsyncThunk } from '@reduxjs/toolkit';
import { memoriesApi } from '@/features/agents/api/memoriesApi';
import type { RootState } from '@/app/store';
import type { MemoryInfo } from '@uniffy/proto/agents/v1/memories_pb';
import { MemoryCategory } from '@uniffy/proto/agents/v1/memories_pb';

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

export const memoryToPlain = (memory: MemoryInfo) => ({
    id: memory.id,
    agentId: memory.agentId,
    key: memory.key,
    content: memory.content,
    category: memory.category,
    importance: memory.importance,
    accessCount: memory.accessCount,
    createdAt: timestampToPlain(memory.createdAt),
    updatedAt: timestampToPlain(memory.updatedAt),
});

export type SerializedMemory = ReturnType<typeof memoryToPlain>;

export const createMemory = createAsyncThunk<
    SerializedMemory,
    { agentId: string; key: string; content: string; category?: number; importance?: number },
    { state: RootState; rejectValue: string }
>('agentMemories/createMemory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.createMemory({
            organizationId,
            agentId: params.agentId,
            key: params.key,
            content: params.content,
            category: params.category !== undefined ? params.category as MemoryCategory : undefined,
            importance: params.importance,
        });
        if (!response.memory) throw new Error('No memory in response');
        return memoryToPlain(response.memory);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create memory');
    }
});

export const fetchMemories = createAsyncThunk<
    SerializedMemory[],
    { agentId: string; category?: number; search?: string },
    { state: RootState; rejectValue: string }
>('agentMemories/fetchMemories', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.listMemories({
            organizationId,
            agentId: params.agentId,
            category: params.category !== undefined ? params.category as MemoryCategory : undefined,
            search: params.search || undefined,
        });
        return response.memories.map(memoryToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch memories');
    }
});

export const updateMemory = createAsyncThunk<
    SerializedMemory,
    { memoryId: string; content?: string; category?: number; importance?: number },
    { state: RootState; rejectValue: string }
>('agentMemories/updateMemory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const { memoryId, ...fields } = params;
        const response = await memoriesApi.updateMemory({
            organizationId,
            memoryId,
            content: fields.content,
            category: fields.category !== undefined ? fields.category as MemoryCategory : undefined,
            importance: fields.importance,
        });
        if (!response.memory) throw new Error('No memory in response');
        return memoryToPlain(response.memory);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update memory');
    }
});

export const deleteMemory = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agentMemories/deleteMemory', async (memoryId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await memoriesApi.deleteMemory({ organizationId, memoryId });
        return memoryId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete memory');
    }
});
