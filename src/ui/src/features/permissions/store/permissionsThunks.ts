import { createAsyncThunk } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { membersApi } from '@/features/permissions/api/membersApi';
import type {
    ContentAccessPolicy as ProtoContentAccessPolicy,
    ContentMember as ProtoContentMember,
    ContentMemberEvent as ProtoContentMemberEvent,
} from '@uniffy/proto/permissions/v1/permissions_pb';
import { create } from '@bufbuild/protobuf';
import { timestampFromDate, type Timestamp } from '@bufbuild/protobuf/wkt';
import { PaginationRequestSchema } from '@uniffy/proto/common/v1/common_pb';
import type {
    ContentAccessPolicy,
    SerializedContentMember,
    SerializedMemberEvent,
    SerializedTimestamp,
} from '@/features/permissions/store/permissionsSlice';

function serializeTimestamp(ts: Timestamp | undefined): SerializedTimestamp | null {
    if (!ts) return null;
    return { seconds: ts.seconds.toString(), nanos: ts.nanos };
}

function serializePolicy(policy: ProtoContentAccessPolicy | undefined): ContentAccessPolicy {
    if (!policy) return { ownerId: '', accessMode: 0, baselineRole: null, callerRole: null };
    return {
        ownerId: policy.ownerId,
        accessMode: policy.accessMode,
        baselineRole: policy.baselineRole ?? null,
        callerRole: policy.callerRole ?? null,
    };
}

function serializeMember(m: ProtoContentMember): SerializedContentMember {
    return {
        subjectType: m.subjectType,
        subjectId: m.subjectId,
        role: m.role,
        addedByUserId: m.addedByUserId,
        addedAt: serializeTimestamp(m.addedAt),
        updatedAt: serializeTimestamp(m.updatedAt),
        expiresAt: serializeTimestamp(m.expiresAt),
    };
}

function serializeEvent(e: ProtoContentMemberEvent): SerializedMemberEvent {
    return {
        id: e.id,
        contentType: e.contentType,
        contentId: e.contentId,
        action: e.action,
        subjectType: e.subjectType ?? null,
        subjectId: e.subjectId ?? null,
        previousRole: e.previousRole ?? null,
        newRole: e.newRole ?? null,
        previousAccessMode: e.previousAccessMode ?? null,
        newAccessMode: e.newAccessMode ?? null,
        previousBaselineRole: e.previousBaselineRole ?? null,
        newBaselineRole: e.newBaselineRole ?? null,
        previousOwnerId: e.previousOwnerId ?? null,
        newOwnerId: e.newOwnerId ?? null,
        actorUserId: e.actorUserId,
        actorOrgRole: e.actorOrgRole,
        note: e.note,
        occurredAt: serializeTimestamp(e.occurredAt),
    };
}

function getOrgId(getState: () => RootState): string | null {
    return getState().auth.currentOrganizationId ?? null;
}

export const fetchContentMembers = createAsyncThunk<
    { policy: ContentAccessPolicy; members: SerializedContentMember[] },
    { contentType: number; contentId: string },
    { state: RootState; rejectValue: string }
>('permissions/fetchContentMembers', async ({ contentType, contentId }, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        const response = await membersApi.listMembers({ organizationId, contentType, contentId });
        return {
            policy: serializePolicy(response.policy),
            members: response.members.map(serializeMember),
        };
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch members');
    }
});

export interface AddContentMemberArgs {
    contentType: number;
    contentId: string;
    subjectType: number;
    subjectId: string;
    role: number;
    expiresAt?: Date;
    note?: string;
}

export const addContentMember = createAsyncThunk<
    SerializedContentMember,
    AddContentMemberArgs,
    { state: RootState; rejectValue: string }
>('permissions/addMember', async (args, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        const response = await membersApi.addMember({
            organizationId,
            contentType: args.contentType,
            contentId: args.contentId,
            subjectType: args.subjectType,
            subjectId: args.subjectId,
            role: args.role,
            expiresAt: args.expiresAt
                ? timestampFromDate(args.expiresAt)
                : undefined,
            note: args.note ?? '',
        });
        if (!response.member) return rejectWithValue('No member returned');
        return serializeMember(response.member);
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to add member');
    }
});

export interface UpdateContentMemberRoleArgs {
    contentType: number;
    contentId: string;
    subjectType: number;
    subjectId: string;
    newRole: number;
    note?: string;
}

export const updateContentMemberRole = createAsyncThunk<
    SerializedContentMember,
    UpdateContentMemberRoleArgs,
    { state: RootState; rejectValue: string }
>('permissions/updateMemberRole', async (args, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        const response = await membersApi.updateMemberRole({
            organizationId,
            contentType: args.contentType,
            contentId: args.contentId,
            subjectType: args.subjectType,
            subjectId: args.subjectId,
            newRole: args.newRole,
            note: args.note ?? '',
        });
        if (!response.member) return rejectWithValue('No member returned');
        return serializeMember(response.member);
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to update role');
    }
});

export interface RemoveContentMemberArgs {
    contentType: number;
    contentId: string;
    subjectType: number;
    subjectId: string;
    note?: string;
}

export const removeContentMember = createAsyncThunk<
    void,
    RemoveContentMemberArgs,
    { state: RootState; rejectValue: string }
>('permissions/removeMember', async (args, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        await membersApi.removeMember({
            organizationId,
            contentType: args.contentType,
            contentId: args.contentId,
            subjectType: args.subjectType,
            subjectId: args.subjectId,
            note: args.note ?? '',
        });
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to remove member');
    }
});

export interface SetContentAccessModeArgs {
    contentType: number;
    contentId: string;
    accessMode: number;
    baselineRole: number | null;
    removeMembersOnNarrow?: boolean;
    note?: string;
}

export const setContentAccessMode = createAsyncThunk<
    { policy: ContentAccessPolicy },
    SetContentAccessModeArgs,
    { state: RootState; rejectValue: string }
>('permissions/setAccessMode', async (args, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        const response = await membersApi.setAccessMode({
            organizationId,
            contentType: args.contentType,
            contentId: args.contentId,
            accessMode: args.accessMode,
            baselineRole: args.baselineRole ?? undefined,
            removeMembersOnNarrow: args.removeMembersOnNarrow ?? false,
            note: args.note ?? '',
        });
        return { policy: serializePolicy(response.policy) };
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to update access mode');
    }
});

export interface TransferContentOwnershipArgs {
    contentType: number;
    contentId: string;
    newOwnerUserId: string;
    note?: string;
}

export const transferContentOwnership = createAsyncThunk<
    { policy: ContentAccessPolicy },
    TransferContentOwnershipArgs,
    { state: RootState; rejectValue: string }
>('permissions/transferOwnership', async (args, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        const response = await membersApi.transferOwnership({
            organizationId,
            contentType: args.contentType,
            contentId: args.contentId,
            newOwnerUserId: args.newOwnerUserId,
            note: args.note ?? '',
        });
        return { policy: serializePolicy(response.policy) };
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to transfer ownership');
    }
});

export interface FetchContentAuditLogArgs {
    contentType: number;
    contentId: string;
    page?: number;
    pageSize?: number;
    actorUserId?: string;
    action?: number;
}

export const fetchContentAuditLog = createAsyncThunk<
    { events: SerializedMemberEvent[]; nextPage: number | null },
    FetchContentAuditLogArgs,
    { state: RootState; rejectValue: string }
>('permissions/fetchAuditLog', async (args, { getState, rejectWithValue }) => {
    const organizationId = getOrgId(getState);
    if (!organizationId) return rejectWithValue('No organization selected');
    try {
        const page = args.page ?? 1;
        const pageSize = args.pageSize ?? 25;
        const response = await membersApi.listMemberEvents({
            organizationId,
            contentType: args.contentType,
            contentId: args.contentId,
            pagination: create(PaginationRequestSchema, { page, pageSize }),
            actorUserId: args.actorUserId,
            action: args.action,
        });
        const totalPages = response.pagination?.totalPages ?? 0;
        const nextPage = page < totalPages ? page + 1 : null;
        return {
            events: response.events.map(serializeEvent),
            nextPage,
        };
    } catch (err) {
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to load audit log');
    }
});
