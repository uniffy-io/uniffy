import { createAsyncThunk } from '@reduxjs/toolkit';
import { Timestamp } from '@bufbuild/protobuf';
import { presenceApi } from '@/features/presence/api/presenceApi';
import {
    updateBulkPresence,
    setMyCustomStatus,
    clearMyCustomStatus,
} from '@/features/presence/store/presenceSlice';
import type { CustomStatus } from '@/features/presence/store/presenceSlice';
import type { RootState } from '@/app/store';

export const fetchBulkPresence = createAsyncThunk(
    'presence/fetchBulkPresence',
    async (
        { organizationId, userIds }: { organizationId: string; userIds: string[] },
        { dispatch, rejectWithValue },
    ) => {
        try {
            const response = await presenceApi.getBulkPresence({
                organizationId,
                userIds,
            });

            const bulk: Record<string, { status: string; customStatus?: CustomStatus }> = {};

            for (const [userId, presence] of Object.entries(response.presences)) {
                const statusMap: Record<number, string> = {
                    1: 'online',
                    2: 'away',
                    3: 'dnd',
                    4: 'offline',
                };
                const status = statusMap[presence.status] ?? 'offline';
                const customStatus: CustomStatus | undefined =
                    presence.statusEmoji || presence.statusText
                        ? {
                              emoji: presence.statusEmoji,
                              text: presence.statusText,
                              expiresAt: presence.statusExpiresAt
                                  ? presence.statusExpiresAt.toDate().toISOString()
                                  : null,
                          }
                        : undefined;

                bulk[userId] = { status, customStatus };
            }

            dispatch(updateBulkPresence(bulk));
            return bulk;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to fetch presence',
            );
        }
    },
);

export const setCustomStatus = createAsyncThunk(
    'presence/setCustomStatus',
    async (
        {
            emoji,
            text,
            expiresAt,
        }: { emoji: string; text: string; expiresAt?: Date },
        { dispatch, getState, rejectWithValue },
    ) => {
        try {
            const state = getState() as RootState;
            const userId = state.auth.user?.id;
            if (!userId) return rejectWithValue('Not authenticated');

            // Optimistic update
            const customStatus: CustomStatus = {
                emoji,
                text,
                expiresAt: expiresAt?.toISOString() ?? null,
            };
            dispatch(setMyCustomStatus({ userId, customStatus }));

            await presenceApi.setCustomStatus({
                emoji,
                text,
                expiresAt: expiresAt ? Timestamp.fromDate(expiresAt) : undefined,
            });

            return customStatus;
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to set custom status',
            );
        }
    },
);

export const clearCustomStatusThunk = createAsyncThunk(
    'presence/clearCustomStatus',
    async (_, { dispatch, getState, rejectWithValue }) => {
        try {
            const state = getState() as RootState;
            const userId = state.auth.user?.id;
            if (!userId) return rejectWithValue('Not authenticated');

            dispatch(clearMyCustomStatus(userId));
            await presenceApi.clearCustomStatus({});
        } catch (error) {
            return rejectWithValue(
                error instanceof Error ? error.message : 'Failed to clear custom status',
            );
        }
    },
);
