/**
 * Audit Redux Slice
 *
 * Holds the paginated view of audit_events for /admin/audit-logs.
 * Filters are URL-driven; the slice owns the (cursor, list, hasMore) tuple
 * that the table uses for infinite scroll.
 */

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { SortOrder, type AuditEvent } from '@uniffy/proto/audit/v1/audit_pb';
import { auditApi } from '@/features/admin/api/auditApi';

export type AuditSortDir = 'desc' | 'asc';

export interface AuditFilter {
    actorUserId: string | null;
    actions: string[];
    resourceType: string | null;
    resourceId: string | null;
    fromTime: string | null;
    toTime: string | null;
    sortDir: AuditSortDir;
}

export const EMPTY_FILTER: AuditFilter = {
    actorUserId: null,
    actions: [],
    resourceType: null,
    resourceId: null,
    fromTime: null,
    toTime: null,
    sortDir: 'desc',
};

export interface SerializedAuditEvent {
    id: string;
    organizationId: string;
    actorUserId: string | null;
    actorOrgRole: string | null;
    onBehalfOfUserId: string | null;
    action: string;
    resourceType: string | null;
    resourceId: string | null;
    detailsJson: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
}

export type AuditLoading =
    | 'idle'
    | 'fetching-newest'
    | 'fetching-older'
    | 'error';

interface AuditState {
    events: SerializedAuditEvent[];
    cursor: string | null;
    hasMore: boolean;
    loading: AuditLoading;
    error: string | null;
    filter: AuditFilter;
}

const initialState: AuditState = {
    events: [],
    cursor: null,
    hasMore: false,
    loading: 'idle',
    error: null,
    filter: EMPTY_FILTER,
};

const PAGE_SIZE = 50;

function serializeEvent(event: AuditEvent): SerializedAuditEvent {
    const ts = event.createdAt;
    const createdAt = ts
        ? new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString()
        : '';
    return {
        id: event.id,
        organizationId: event.organizationId,
        actorUserId: event.actorUserId ?? null,
        actorOrgRole: event.actorOrgRole ?? null,
        onBehalfOfUserId: event.onBehalfOfUserId ?? null,
        action: event.action,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        detailsJson: event.detailsJson,
        ipAddress: event.ipAddress ?? null,
        userAgent: event.userAgent ?? null,
        createdAt,
    };
}

function buildRequest(
    organizationId: string,
    filter: AuditFilter,
    pageToken: string | undefined,
    overrideToTime?: string | null,
) {
    const fromTime = filter.fromTime ? new Date(filter.fromTime) : undefined;
    const effectiveTo = overrideToTime !== undefined ? overrideToTime : filter.toTime;
    const toTime = effectiveTo ? new Date(effectiveTo) : undefined;
    return {
        organizationId,
        actorUserId: filter.actorUserId ?? undefined,
        actions: filter.actions,
        resourceType: filter.resourceType ?? undefined,
        resourceId: filter.resourceId ?? undefined,
        fromTime: fromTime ? timestampFromDate(fromTime) : undefined,
        toTime: toTime ? timestampFromDate(toTime) : undefined,
        pageSize: PAGE_SIZE,
        pageToken,
        order:
            filter.sortDir === 'asc'
                ? SortOrder.TIME_ASC
                : SortOrder.TIME_DESC,
    };
}

export const fetchNewestEvents = createAsyncThunk<
    { events: SerializedAuditEvent[]; nextPageToken: string | null; filter: AuditFilter },
    { organizationId: string; filter: AuditFilter },
    { rejectValue: string }
>('audit/fetchNewest', async ({ organizationId, filter }, { rejectWithValue }) => {
    try {
        const response = await auditApi.listEvents(
            buildRequest(organizationId, filter, undefined),
        );
        return {
            events: response.events.map(serializeEvent),
            nextPageToken: response.nextPageToken ?? null,
            filter,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load audit events';
        return rejectWithValue(message);
    }
});

export const fetchOlderEvents = createAsyncThunk<
    { events: SerializedAuditEvent[]; nextPageToken: string | null },
    void,
    { state: { audit: AuditState; auth: { currentOrganizationId: string | null } }; rejectValue: string }
>('audit/fetchOlder', async (_, { getState, rejectWithValue }) => {
    const state = getState();
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) {
        return rejectWithValue('No organization context');
    }
    const cursor = state.audit.cursor;
    if (!cursor) {
        return { events: [], nextPageToken: null };
    }
    try {
        const response = await auditApi.listEvents(
            buildRequest(organizationId, state.audit.filter, cursor),
        );
        return {
            events: response.events.map(serializeEvent),
            nextPageToken: response.nextPageToken ?? null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load audit events';
        return rejectWithValue(message);
    }
});

export const jumpToDate = createAsyncThunk<
    { events: SerializedAuditEvent[]; nextPageToken: string | null; filter: AuditFilter },
    { organizationId: string; filter: AuditFilter; toTime: string },
    { rejectValue: string }
>('audit/jumpToDate', async ({ organizationId, filter, toTime }, { rejectWithValue }) => {
    try {
        const response = await auditApi.listEvents(
            buildRequest(organizationId, filter, undefined, toTime),
        );
        return {
            events: response.events.map(serializeEvent),
            nextPageToken: response.nextPageToken ?? null,
            filter: { ...filter, toTime },
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load audit events';
        return rejectWithValue(message);
    }
});

export const auditSlice = createSlice({
    name: 'audit',
    initialState,
    reducers: {
        setFilter(state, action: PayloadAction<AuditFilter>) {
            state.filter = action.payload;
        },
        clearAuditState() {
            return initialState;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchNewestEvents.pending, (state) => {
                state.loading = 'fetching-newest';
                state.error = null;
            })
            .addCase(fetchNewestEvents.fulfilled, (state, action) => {
                state.events = action.payload.events;
                state.cursor = action.payload.nextPageToken;
                state.hasMore = !!action.payload.nextPageToken;
                state.filter = action.payload.filter;
                state.loading = 'idle';
            })
            .addCase(fetchNewestEvents.rejected, (state, action) => {
                state.loading = 'error';
                state.error = action.payload ?? action.error.message ?? 'Failed to load';
            })
            .addCase(fetchOlderEvents.pending, (state) => {
                state.loading = 'fetching-older';
                state.error = null;
            })
            .addCase(fetchOlderEvents.fulfilled, (state, action) => {
                state.events.push(...action.payload.events);
                state.cursor = action.payload.nextPageToken;
                state.hasMore = !!action.payload.nextPageToken;
                state.loading = 'idle';
            })
            .addCase(fetchOlderEvents.rejected, (state, action) => {
                state.loading = 'error';
                state.error = action.payload ?? action.error.message ?? 'Failed to load';
            })
            .addCase(jumpToDate.pending, (state) => {
                state.loading = 'fetching-newest';
                state.error = null;
            })
            .addCase(jumpToDate.fulfilled, (state, action) => {
                state.events = action.payload.events;
                state.cursor = action.payload.nextPageToken;
                state.hasMore = !!action.payload.nextPageToken;
                state.filter = action.payload.filter;
                state.loading = 'idle';
            })
            .addCase(jumpToDate.rejected, (state, action) => {
                state.loading = 'error';
                state.error = action.payload ?? action.error.message ?? 'Failed to load';
            });
    },
});

export const { setFilter, clearAuditState } = auditSlice.actions;
export const auditReducer = auditSlice.reducer;
