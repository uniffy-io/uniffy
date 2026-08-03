import { describe, it, expect } from 'vitest';
import { OrganizationRole } from '@uniffy/proto/common/v1/common_pb';

import { clearPeople, peopleReducer } from '@/features/people/store/peopleSlice';
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

const emptyState = peopleReducer(undefined, { type: 'test/init' });

function buildPerson(overrides: Partial<SerializedPersonProfile> = {}): SerializedPersonProfile {
    return {
        userId: 'user-1',
        displayName: 'Jane Doe',
        username: 'jane',
        avatarUrl: null,
        hasAvatar: false,
        orgRole: OrganizationRole.MEMBER,
        isActive: true,
        jobTitle: 'VP Engineering',
        department: 'Engineering',
        email: 'jane@example.com',
        workPhone: null,
        mobilePhone: null,
        officeLocation: null,
        timezone: null,
        pronouns: null,
        bio: null,
        startDateMs: null,
        birthday: null,
        links: [],
        managerUserId: null,
        teams: [],
        directReportCount: 0,
        managedFields: [],
        isSelf: false,
        canEdit: false,
        ...overrides,
    };
}

function buildChartNode(overrides: Partial<SerializedOrgChartNode> = {}): SerializedOrgChartNode {
    return {
        userId: 'user-1',
        displayName: 'Jane Doe',
        avatarUrl: null,
        jobTitle: null,
        department: null,
        managerUserId: null,
        teams: [],
        descendantCount: 0,
        ...overrides,
    };
}

function buildTeam(overrides: Partial<SerializedTeamNode> = {}): SerializedTeamNode {
    return {
        groupId: 'team-1',
        name: 'Platform',
        description: null,
        parentGroupId: null,
        leadUserId: null,
        ...overrides,
    };
}

// createAsyncThunk actions carry `meta.arg`, which the pending/rejected
// handlers key their per-person status on.
const fulfilled = <T>(thunk: { fulfilled: { type: string } }, payload: T, arg: unknown = {}) => ({
    type: thunk.fulfilled.type,
    payload,
    meta: { arg, requestId: 'r1', requestStatus: 'fulfilled' as const },
});

const pending = (thunk: { pending: { type: string } }, arg: unknown = {}) => ({
    type: thunk.pending.type,
    payload: undefined,
    meta: { arg, requestId: 'r1', requestStatus: 'pending' as const },
});

const rejected = (
    thunk: { rejected: { type: string } },
    arg: unknown = {},
    payload?: unknown,
    errorMessage = 'boom',
) => ({
    type: thunk.rejected.type,
    payload,
    error: { message: errorMessage },
    meta: { arg, requestId: 'r1', requestStatus: 'rejected' as const },
});

describe('peopleSlice initial state', () => {
    it('assumes both people surfaces are on until the policy loads', () => {
        expect(emptyState.policy).toEqual({
            directoryEnabled: true,
            orgChartEnabled: true,
            status: 'idle',
        });
    });

    it('starts with no profiles and an idle chart', () => {
        expect(emptyState.profilesById).toEqual({});
        expect(emptyState.chart.status).toBe('idle');
        expect(emptyState.chart.nodes).toEqual([]);
    });
});

describe('person fetching', () => {
    it('tracks status per user id', () => {
        const state = peopleReducer(emptyState, pending(fetchPersonThunk, { userId: 'user-9' }));
        expect(state.profileStatusById['user-9']).toBe('loading');
        expect(state.profileStatusById['user-1']).toBeUndefined();
    });

    it('stores the person and marks it succeeded', () => {
        const person = buildPerson();
        const state = peopleReducer(emptyState, fulfilled(fetchPersonThunk, person));

        expect(state.profilesById['user-1']).toEqual(person);
        expect(state.profileStatusById['user-1']).toBe('succeeded');
    });

    it('marks only the requested user failed', () => {
        const seeded = peopleReducer(emptyState, fulfilled(fetchPersonThunk, buildPerson()));
        const state = peopleReducer(seeded, rejected(fetchPersonThunk, { userId: 'user-9' }));

        expect(state.profileStatusById['user-9']).toBe('failed');
        expect(state.profileStatusById['user-1']).toBe('succeeded');
    });

    it('a refetch replaces the stored person rather than merging it', () => {
        const seeded = peopleReducer(
            emptyState,
            fulfilled(fetchPersonThunk, buildPerson({ jobTitle: 'VP Engineering' })),
        );
        const state = peopleReducer(
            seeded,
            fulfilled(fetchPersonThunk, buildPerson({ jobTitle: null })),
        );

        expect(state.profilesById['user-1'].jobTitle).toBeNull();
    });
});

describe('profile writes', () => {
    it('a self edit lands in the cache', () => {
        const person = buildPerson({ isSelf: true, bio: 'Ships things.' });
        const state = peopleReducer(emptyState, fulfilled(updateMyProfileThunk, person));

        expect(state.profilesById['user-1'].bio).toBe('Ships things.');
        expect(state.profileStatusById['user-1']).toBe('succeeded');
    });

    it('an admin edit of another member lands in the cache', () => {
        const person = buildPerson({ userId: 'user-2', jobTitle: 'Staff Engineer' });
        const state = peopleReducer(emptyState, fulfilled(updatePersonProfileThunk, person));

        expect(state.profilesById['user-2'].jobTitle).toBe('Staff Engineer');
    });
});

describe('setManager', () => {
    const seededChart = () =>
        peopleReducer(
            emptyState,
            fulfilled(fetchOrgChartThunk, {
                nodes: [
                    buildChartNode({ userId: 'user-1' }),
                    buildChartNode({ userId: 'user-2', displayName: 'Boss' }),
                ],
                rootUserIds: ['user-2'],
                teams: [],
                truncated: false,
                enabled: true,
            }),
        );

    it('patches the edge onto the open chart so it updates without a refetch', () => {
        const state = peopleReducer(
            seededChart(),
            fulfilled(setManagerThunk, buildPerson({ managerUserId: 'user-2' })),
        );

        expect(state.chart.nodes.find((n) => n.userId === 'user-1')?.managerUserId).toBe('user-2');
    });

    it('clears the edge when the manager is removed', () => {
        const withManager = peopleReducer(
            seededChart(),
            fulfilled(setManagerThunk, buildPerson({ managerUserId: 'user-2' })),
        );
        const state = peopleReducer(
            withManager,
            fulfilled(setManagerThunk, buildPerson({ managerUserId: null })),
        );

        expect(state.chart.nodes.find((n) => n.userId === 'user-1')?.managerUserId).toBeNull();
    });

    it('resets the chart to idle so descendant counts get rebuilt on next mount', () => {
        const state = peopleReducer(
            seededChart(),
            fulfilled(setManagerThunk, buildPerson({ managerUserId: 'user-2' })),
        );

        expect(state.chart.status).toBe('idle');
    });

    it('a person outside the loaded chart still updates the profile cache', () => {
        const state = peopleReducer(
            seededChart(),
            fulfilled(setManagerThunk, buildPerson({ userId: 'user-77', managerUserId: 'user-2' })),
        );

        expect(state.profilesById['user-77'].managerUserId).toBe('user-2');
        expect(state.chart.nodes).toHaveLength(2);
    });
});

describe('profile policy', () => {
    it('applies a disabled directory', () => {
        const state = peopleReducer(
            emptyState,
            fulfilled(fetchProfilePolicyThunk, {
                directoryEnabled: false,
                orgChartEnabled: true,
            }),
        );

        expect(state.policy).toEqual({
            directoryEnabled: false,
            orgChartEnabled: true,
            status: 'succeeded',
        });
    });

    it('leaves the flags alone when the fetch fails', () => {
        const state = peopleReducer(emptyState, rejected(fetchProfilePolicyThunk));

        expect(state.policy.status).toBe('failed');
        expect(state.policy.directoryEnabled).toBe(true);
    });
});

describe('teams', () => {
    it('stores the member ids under the team id', () => {
        const state = peopleReducer(
            emptyState,
            fulfilled(fetchTeamThunk, {
                team: buildTeam(),
                memberUserIds: ['user-1', 'user-2'],
            }),
        );

        expect(state.teams.memberIdsByTeam['team-1']).toEqual(['user-1', 'user-2']);
        expect(state.teams.items).toHaveLength(1);
    });

    it('replaces a team in place instead of appending a duplicate', () => {
        const seeded = peopleReducer(
            emptyState,
            fulfilled(fetchTeamThunk, { team: buildTeam(), memberUserIds: ['user-1'] }),
        );
        const state = peopleReducer(
            seeded,
            fulfilled(fetchTeamThunk, {
                team: buildTeam({ name: 'Platform Team' }),
                memberUserIds: ['user-1', 'user-3'],
            }),
        );

        expect(state.teams.items).toHaveLength(1);
        expect(state.teams.items[0].name).toBe('Platform Team');
        expect(state.teams.memberIdsByTeam['team-1']).toEqual(['user-1', 'user-3']);
    });

    it('keeps distinct teams side by side', () => {
        const seeded = peopleReducer(
            emptyState,
            fulfilled(fetchTeamThunk, { team: buildTeam(), memberUserIds: [] }),
        );
        const state = peopleReducer(
            seeded,
            fulfilled(fetchTeamThunk, {
                team: buildTeam({ groupId: 'team-2', name: 'Sales' }),
                memberUserIds: [],
            }),
        );

        expect(state.teams.items.map((t) => t.groupId)).toEqual(['team-1', 'team-2']);
    });
});

describe('org chart', () => {
    it('clears a previous error when a new fetch starts', () => {
        const failed = peopleReducer(emptyState, rejected(fetchOrgChartThunk));
        const state = peopleReducer(failed, pending(fetchOrgChartThunk));

        expect(state.chart.status).toBe('loading');
        expect(state.chart.error).toBeNull();
    });

    it('stores nodes, roots, teams and the truncation flag', () => {
        const state = peopleReducer(
            emptyState,
            fulfilled(fetchOrgChartThunk, {
                nodes: [buildChartNode()],
                rootUserIds: ['user-1'],
                teams: [buildTeam()],
                truncated: true,
                enabled: true,
            }),
        );

        expect(state.chart.nodes).toHaveLength(1);
        expect(state.chart.rootUserIds).toEqual(['user-1']);
        expect(state.chart.teams).toHaveLength(1);
        expect(state.chart.truncated).toBe(true);
        expect(state.chart.status).toBe('succeeded');
    });

    it('carries the disabled flag so the page can tell it apart from an empty chart', () => {
        const state = peopleReducer(
            emptyState,
            fulfilled(fetchOrgChartThunk, {
                nodes: [],
                rootUserIds: [],
                teams: [],
                truncated: false,
                enabled: false,
            }),
        );

        expect(state.chart.enabled).toBe(false);
        expect(state.chart.status).toBe('succeeded');
    });

    it('prefers the rejected payload over the raw error message', () => {
        const state = peopleReducer(
            emptyState,
            rejected(fetchOrgChartThunk, {}, 'permission denied', 'raw'),
        );

        expect(state.chart.status).toBe('failed');
        expect(state.chart.error).toBe('permission denied');
    });

    it('falls back to the error message when there is no payload', () => {
        const state = peopleReducer(emptyState, rejected(fetchOrgChartThunk, {}, undefined, 'raw'));
        expect(state.chart.error).toBe('raw');
    });
});

describe('clearPeople', () => {
    it('drops every user-scoped bucket on logout', () => {
        const seeded = peopleReducer(
            peopleReducer(
                emptyState,
                fulfilled(fetchPersonThunk, buildPerson({ isSelf: true })),
            ),
            fulfilled(fetchOrgChartThunk, {
                nodes: [buildChartNode()],
                rootUserIds: ['user-1'],
                teams: [buildTeam()],
                truncated: false,
                enabled: true,
            }),
        );

        expect(peopleReducer(seeded, clearPeople())).toEqual(emptyState);
    });
});
