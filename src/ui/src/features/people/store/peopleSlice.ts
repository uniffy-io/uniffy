import { createSlice } from '@reduxjs/toolkit';

import {
    fetchOrgChartThunk,
    fetchPersonThunk,
    fetchProfilePolicyThunk,
    fetchTeamThunk,
    setManagerThunk,
    updateMyProfileThunk,
    updatePersonProfileThunk,
    type SerializedOrgChartNode,
    type SerializedPersonProfile,
    type SerializedTeamNode,
} from '@/features/people/store/peopleThunks';

type RequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface PeopleState {
    profilesById: Record<string, SerializedPersonProfile>;

    profileStatusById: Record<string, RequestStatus>;

    policy: {
        directoryEnabled: boolean;
        orgChartEnabled: boolean;
        status: RequestStatus;
    };

    teams: {
        items: SerializedTeamNode[];
        memberIdsByTeam: Record<string, string[]>;
        status: RequestStatus;
    };

    chart: {
        nodes: SerializedOrgChartNode[];
        rootUserIds: string[];
        teams: SerializedTeamNode[];
        truncated: boolean;
        enabled: boolean;
        status: RequestStatus;
        error: string | null;
    };
}

const initialState: PeopleState = {
    profilesById: {},

    profileStatusById: {},

    policy: {
        directoryEnabled: true,
        orgChartEnabled: true,
        status: 'idle',
    },

    teams: {
        items: [],
        memberIdsByTeam: {},
        status: 'idle',
    },

    chart: {
        nodes: [],
        rootUserIds: [],
        teams: [],
        truncated: false,
        enabled: true,
        status: 'idle',
        error: null,
    },
};

function upsertProfile(state: PeopleState, person: SerializedPersonProfile): void {
    state.profilesById[person.userId] = person;
    state.profileStatusById[person.userId] = 'succeeded';
}

const peopleSlice = createSlice({
    name: 'people',
    initialState,
    reducers: {
        clearPeople() {
            return initialState;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchPersonThunk.pending, (state, action) => {
                state.profileStatusById[action.meta.arg.userId] = 'loading';
            })
            .addCase(fetchPersonThunk.fulfilled, (state, action) => {
                upsertProfile(state, action.payload);
            })
            .addCase(fetchPersonThunk.rejected, (state, action) => {
                state.profileStatusById[action.meta.arg.userId] = 'failed';
            });

        builder
            .addCase(updateMyProfileThunk.fulfilled, (state, action) => {
                upsertProfile(state, action.payload);
            })
            .addCase(updatePersonProfileThunk.fulfilled, (state, action) => {
                upsertProfile(state, action.payload);
            })
            .addCase(setManagerThunk.fulfilled, (state, action) => {
                upsertProfile(state, action.payload);
                // Patch the edge in place so an open chart consumer reflects the
                // change; status idle still makes the next mount refetch, which
                // is what rebuilds descendant counts.
                const node = state.chart.nodes.find((n) => n.userId === action.payload.userId);
                if (node) node.managerUserId = action.payload.managerUserId;
                state.chart.status = 'idle';
            });

        builder
            .addCase(fetchProfilePolicyThunk.pending, (state) => {
                state.policy.status = 'loading';
            })
            .addCase(fetchProfilePolicyThunk.fulfilled, (state, action) => {
                state.policy.directoryEnabled = action.payload.directoryEnabled;
                state.policy.orgChartEnabled = action.payload.orgChartEnabled;
                state.policy.status = 'succeeded';
            })
            .addCase(fetchProfilePolicyThunk.rejected, (state) => {
                state.policy.status = 'failed';
            });

        builder
            .addCase(fetchTeamThunk.fulfilled, (state, action) => {
                const { team, memberUserIds } = action.payload;
                state.teams.memberIdsByTeam[team.groupId] = memberUserIds;
                const index = state.teams.items.findIndex((t) => t.groupId === team.groupId);
                if (index >= 0) {
                    state.teams.items[index] = team;
                } else {
                    state.teams.items.push(team);
                }
            });

        builder
            .addCase(fetchOrgChartThunk.pending, (state) => {
                state.chart.status = 'loading';
                state.chart.error = null;
            })
            .addCase(fetchOrgChartThunk.fulfilled, (state, action) => {
                state.chart.nodes = action.payload.nodes;
                state.chart.rootUserIds = action.payload.rootUserIds;
                state.chart.teams = action.payload.teams;
                state.chart.truncated = action.payload.truncated;
                state.chart.enabled = action.payload.enabled;
                state.chart.status = 'succeeded';
            })
            .addCase(fetchOrgChartThunk.rejected, (state, action) => {
                state.chart.status = 'failed';
                state.chart.error =
                    (action.payload as string | undefined) ?? action.error.message ?? null;
            });
    },
});

export const { clearPeople } = peopleSlice.actions;
export const peopleReducer = peopleSlice.reducer;
