import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
    fetchContentMembers,
    addContentMember,
    updateContentMemberRole,
    removeContentMember,
    setContentAccessMode,
    transferContentOwnership,
    fetchContentAuditLog,
} from '@/features/permissions/store/permissionsThunks';

export interface SerializedTimestamp {
    seconds: string;
    nanos: number;
}

export interface ContentAccessPolicy {
    ownerId: string;
    accessMode: number;
    baselineRole: number | null;
    /** The current user's backend-resolved effective role; null = no access. */
    callerRole: number | null;
    /** Live access mode after inheriting org defaults; null = not provided. */
    effectiveAccessMode: number | null;
}

export interface SerializedContentMember {
    subjectType: number;
    subjectId: string;
    role: number;
    addedByUserId: string;
    addedAt: SerializedTimestamp | null;
    updatedAt: SerializedTimestamp | null;
    expiresAt: SerializedTimestamp | null;
}

export interface SerializedMemberEvent {
    id: string;
    contentType: number;
    contentId: string;
    action: number;
    subjectType: number | null;
    subjectId: string | null;
    previousRole: number | null;
    newRole: number | null;
    previousAccessMode: number | null;
    newAccessMode: number | null;
    previousBaselineRole: number | null;
    newBaselineRole: number | null;
    previousOwnerId: string | null;
    newOwnerId: string | null;
    actorUserId: string;
    actorOrgRole: number;
    note: string;
    occurredAt: SerializedTimestamp | null;
}

export interface ContentPermissionsEntry {
    policy: ContentAccessPolicy | null;
    members: SerializedContentMember[];
    auditEvents: SerializedMemberEvent[];
    auditCursor: number | null;
    loading: { members: boolean; audit: boolean; mutation: boolean };
    errors: { members: string | null; audit: string | null; mutation: string | null };
}

export interface PermissionsState {
    byContent: Record<string, ContentPermissionsEntry>;
}

const initialState: PermissionsState = {
    byContent: {},
};

function contentKey(contentType: number, contentId: string): string {
    return `${contentType}:${contentId}`;
}

function emptyEntry(): ContentPermissionsEntry {
    return {
        policy: null,
        members: [],
        auditEvents: [],
        auditCursor: null,
        loading: { members: false, audit: false, mutation: false },
        errors: { members: null, audit: null, mutation: null },
    };
}

function ensureEntry(state: PermissionsState, key: string): ContentPermissionsEntry {
    if (!state.byContent[key]) {
        state.byContent[key] = emptyEntry();
    }
    return state.byContent[key];
}

const permissionsSlice = createSlice({
    name: 'permissions',
    initialState,
    reducers: {
        clearPermissions: (state) => {
            state.byContent = {};
        },
        clearContentMembers: (state, action: PayloadAction<{ contentType: number; contentId: string }>) => {
            const key = contentKey(action.payload.contentType, action.payload.contentId);
            delete state.byContent[key];
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchContentMembers.pending, (state, action) => {
                const { contentType, contentId } = action.meta.arg;
                const entry = ensureEntry(state, contentKey(contentType, contentId));
                entry.loading.members = true;
                entry.errors.members = null;
            })
            .addCase(fetchContentMembers.fulfilled, (state, action) => {
                const { contentType, contentId } = action.meta.arg;
                const entry = ensureEntry(state, contentKey(contentType, contentId));
                entry.policy = action.payload.policy;
                entry.members = action.payload.members;
                entry.loading.members = false;
            })
            .addCase(fetchContentMembers.rejected, (state, action) => {
                const { contentType, contentId } = action.meta.arg;
                const entry = ensureEntry(state, contentKey(contentType, contentId));
                entry.loading.members = false;
                entry.errors.members = (action.payload as string | undefined) ?? 'Failed to load members';
            })
            .addCase(addContentMember.pending, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = true;
                entry.errors.mutation = null;
            })
            .addCase(addContentMember.fulfilled, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                const member = action.payload;
                const idx = entry.members.findIndex(
                    (m) => m.subjectType === member.subjectType && m.subjectId === member.subjectId,
                );
                if (idx >= 0) entry.members[idx] = member;
                else entry.members.push(member);
            })
            .addCase(addContentMember.rejected, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.errors.mutation = (action.payload as string | undefined) ?? 'Failed to add member';
            })
            .addCase(updateContentMemberRole.pending, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = true;
                entry.errors.mutation = null;
            })
            .addCase(updateContentMemberRole.fulfilled, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                const member = action.payload;
                const idx = entry.members.findIndex(
                    (m) => m.subjectType === member.subjectType && m.subjectId === member.subjectId,
                );
                if (idx >= 0) entry.members[idx] = member;
                else entry.members.push(member);
            })
            .addCase(updateContentMemberRole.rejected, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.errors.mutation = (action.payload as string | undefined) ?? 'Failed to update role';
            })
            .addCase(removeContentMember.pending, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = true;
                entry.errors.mutation = null;
            })
            .addCase(removeContentMember.fulfilled, (state, action) => {
                const { contentType, contentId, subjectType, subjectId } = action.meta.arg;
                const entry = ensureEntry(state, contentKey(contentType, contentId));
                entry.loading.mutation = false;
                entry.members = entry.members.filter(
                    (m) => !(m.subjectType === subjectType && m.subjectId === subjectId),
                );
            })
            .addCase(removeContentMember.rejected, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.errors.mutation = (action.payload as string | undefined) ?? 'Failed to remove member';
            })
            .addCase(setContentAccessMode.pending, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = true;
                entry.errors.mutation = null;
            })
            .addCase(setContentAccessMode.fulfilled, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.policy = action.payload.policy;
            })
            .addCase(setContentAccessMode.rejected, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.errors.mutation = (action.payload as string | undefined) ?? 'Failed to update access mode';
            })
            .addCase(transferContentOwnership.pending, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = true;
                entry.errors.mutation = null;
            })
            .addCase(transferContentOwnership.fulfilled, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.policy = action.payload.policy;
            })
            .addCase(transferContentOwnership.rejected, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.mutation = false;
                entry.errors.mutation = (action.payload as string | undefined) ?? 'Failed to transfer ownership';
            })
            .addCase(fetchContentAuditLog.pending, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.audit = true;
                entry.errors.audit = null;
            })
            .addCase(fetchContentAuditLog.fulfilled, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.audit = false;
                const page = action.meta.arg.page ?? 1;
                if (page <= 1) {
                    entry.auditEvents = action.payload.events;
                } else {
                    entry.auditEvents = [...entry.auditEvents, ...action.payload.events];
                }
                entry.auditCursor = action.payload.nextPage;
            })
            .addCase(fetchContentAuditLog.rejected, (state, action) => {
                const entry = ensureEntry(state, contentKey(action.meta.arg.contentType, action.meta.arg.contentId));
                entry.loading.audit = false;
                entry.errors.audit = (action.payload as string | undefined) ?? 'Failed to load audit log';
            });
    },
});

export const { clearPermissions, clearContentMembers } = permissionsSlice.actions;
export const permissionsReducer = permissionsSlice.reducer;
