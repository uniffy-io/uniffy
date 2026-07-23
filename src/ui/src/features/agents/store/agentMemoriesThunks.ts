import { createAsyncThunk } from '@reduxjs/toolkit';
import { memoriesApi } from '@/features/agents/api/memoriesApi';
import type { RootState } from '@/app/store';
import type { MemoryInfo } from '@uniffy/proto/agents/v1/memories_pb';
import { MemoryCategory, MemoryScope } from '@uniffy/proto/agents/v1/memories_pb';

export interface MemoryScopeSubject {
    scope: MemoryScope;
    subjectId?: string;
}

export const memoryScopeKey = (subject: MemoryScopeSubject): string =>
    `${subject.scope}:${subject.subjectId ?? 'org'}`;

const subjectIds = (subject: MemoryScopeSubject) => ({
    channelId: subject.scope === MemoryScope.CHANNEL ? subject.subjectId : undefined,
    sessionId: subject.scope === MemoryScope.SESSION ? subject.subjectId : undefined,
});

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
    scope: memory.scope,
    description: memory.description,
    pinned: memory.pinned,
    source: memory.source,
    createdByUserId: memory.createdByUserId,
    createdByName: memory.createdByName,
    channelId: memory.channelId,
    sessionId: memory.sessionId,
    createdAt: timestampToPlain(memory.createdAt),
    updatedAt: timestampToPlain(memory.updatedAt),
});

export type SerializedMemory = ReturnType<typeof memoryToPlain>;

export const fetchMemories = createAsyncThunk<
    { scopeKey: string; memories: SerializedMemory[]; totalCount: number },
    MemoryScopeSubject & { agentId: string; category?: number; search?: string },
    { state: RootState; rejectValue: string }
>('agentMemories/fetchMemories', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.listMemories({
            organizationId,
            agentId: params.agentId,
            scope: params.scope,
            ...subjectIds(params),
            category: params.category !== undefined ? params.category as MemoryCategory : undefined,
            search: params.search || undefined,
        });
        const memories = response.memories.map(memoryToPlain);
        return {
            scopeKey: memoryScopeKey(params),
            memories,
            totalCount: response.pagination?.totalCount || memories.length,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch memories');
    }
});

export const createMemory = createAsyncThunk<
    { scopeKey: string; memory: SerializedMemory },
    MemoryScopeSubject & {
        agentId: string;
        key: string;
        description: string;
        content: string;
        category?: number;
        importance?: number;
    },
    { state: RootState; rejectValue: string }
>('agentMemories/createMemory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.createMemory({
            organizationId,
            agentId: params.agentId,
            scope: params.scope,
            ...subjectIds(params),
            key: params.key,
            description: params.description,
            content: params.content,
            category: params.category !== undefined ? params.category as MemoryCategory : undefined,
            importance: params.importance,
        });
        if (!response.memory) throw new Error('No memory in response');
        return { scopeKey: memoryScopeKey(params), memory: memoryToPlain(response.memory) };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create memory');
    }
});

export const updateMemory = createAsyncThunk<
    { scopeKey: string; memory: SerializedMemory },
    {
        scopeKey: string;
        memoryId: string;
        description?: string;
        content?: string;
        category?: number;
        importance?: number;
    },
    { state: RootState; rejectValue: string }
>('agentMemories/updateMemory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.updateMemory({
            organizationId,
            memoryId: params.memoryId,
            description: params.description,
            content: params.content,
            category: params.category !== undefined ? params.category as MemoryCategory : undefined,
            importance: params.importance,
        });
        if (!response.memory) throw new Error('No memory in response');
        return { scopeKey: params.scopeKey, memory: memoryToPlain(response.memory) };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update memory');
    }
});

export const deleteMemory = createAsyncThunk<
    { scopeKey: string; memoryId: string },
    { scopeKey: string; memoryId: string },
    { state: RootState; rejectValue: string }
>('agentMemories/deleteMemory', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await memoriesApi.deleteMemory({ organizationId, memoryId: params.memoryId });
        return params;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete memory');
    }
});

export const setMemoryPinned = createAsyncThunk<
    { scopeKey: string; memory: SerializedMemory },
    { scopeKey: string; memoryId: string; pinned: boolean },
    { state: RootState; rejectValue: string }
>('agentMemories/setMemoryPinned', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.setMemoryPinned({
            organizationId,
            memoryId: params.memoryId,
            pinned: params.pinned,
        });
        if (!response.memory) throw new Error('No memory in response');
        return { scopeKey: params.scopeKey, memory: memoryToPlain(response.memory) };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update memory pin');
    }
});

export interface MemorySharingState {
    useInSharedSpaces: boolean;
    orgAllows: boolean;
}

export const fetchMemorySharing = createAsyncThunk<
    MemorySharingState,
    void,
    { state: RootState; rejectValue: string }
>('agentMemories/fetchMemorySharing', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.getMemorySharing({ organizationId });
        return {
            useInSharedSpaces: response.useInSharedSpaces,
            orgAllows: response.orgAllows,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to load memory sharing'
        );
    }
});

export const updateMemorySharing = createAsyncThunk<
    MemorySharingState,
    { useInSharedSpaces: boolean },
    { state: RootState; rejectValue: string }
>('agentMemories/updateMemorySharing', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await memoriesApi.setMemorySharing({
            organizationId,
            useInSharedSpaces: params.useInSharedSpaces,
        });
        return {
            useInSharedSpaces: response.useInSharedSpaces,
            orgAllows: response.orgAllows,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to update memory sharing'
        );
    }
});
