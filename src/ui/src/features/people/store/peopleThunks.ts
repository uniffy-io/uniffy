import { createAsyncThunk } from '@reduxjs/toolkit';
import { timestampFromDate, type Timestamp } from '@bufbuild/protobuf/wkt';
import type { OrganizationRole } from '@uniffy/proto/common/v1/common_pb';
import type {
    OrgChartNode,
    PersonProfile,
    TeamNode,
    TeamRef,
} from '@uniffy/proto/people/v1/people_pb';

import { peopleApi } from '@/features/people/api/peopleApi';
import type { RootState } from '@/app/store';

const getOrgId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

export interface SerializedProfileLink {
    label: string;
    url: string;
}

export interface SerializedTeamRef {
    groupId: string;
    name: string;
    leadUserId: string | null;
}

export interface SerializedPersonProfile {
    userId: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    hasAvatar: boolean;
    orgRole: OrganizationRole;
    isActive: boolean;
    jobTitle: string | null;
    department: string | null;
    email: string | null;
    workPhone: string | null;
    mobilePhone: string | null;
    officeLocation: string | null;
    timezone: string | null;
    pronouns: string | null;
    bio: string | null;
    startDateMs: number | null;
    birthday: string | null;
    links: SerializedProfileLink[];
    managerUserId: string | null;
    teams: SerializedTeamRef[];
    directReportCount: number;
    managedFields: string[];
    isSelf: boolean;
    canEdit: boolean;
}

export interface SerializedTeamNode {
    groupId: string;
    name: string;
    description: string | null;
    parentGroupId: string | null;
    leadUserId: string | null;
}

export interface SerializedOrgChartNode {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    department: string | null;
    managerUserId: string | null;
    teams: SerializedTeamRef[];
    descendantCount: number;
}

const tsToMs = (ts: Timestamp | undefined): number | null =>
    ts ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000) : null;

const teamRefToPlain = (ref: TeamRef): SerializedTeamRef => ({
    groupId: ref.groupId,
    name: ref.name,
    leadUserId: ref.leadUserId ?? null,
});

export const personToPlain = (person: PersonProfile): SerializedPersonProfile => ({
    userId: person.userId,
    displayName: person.displayName,
    username: person.username ?? null,
    avatarUrl: person.avatarUrl ?? null,
    hasAvatar: person.hasAvatar,
    orgRole: person.orgRole,
    isActive: person.isActive,
    jobTitle: person.jobTitle ?? null,
    department: person.department ?? null,
    email: person.email ?? null,
    workPhone: person.workPhone ?? null,
    mobilePhone: person.mobilePhone ?? null,
    officeLocation: person.officeLocation ?? null,
    timezone: person.timezone ?? null,
    pronouns: person.pronouns ?? null,
    bio: person.bio ?? null,
    startDateMs: tsToMs(person.startDate),
    birthday: person.birthday ?? null,
    links: person.links.map((l) => ({ label: l.label, url: l.url })),
    managerUserId: person.managerUserId ?? null,
    teams: person.teams.map(teamRefToPlain),
    directReportCount: person.directReportCount,
    managedFields: [...person.managedFields],
    isSelf: person.isSelf,
    canEdit: person.canEdit,
});

const teamNodeToPlain = (team: TeamNode): SerializedTeamNode => ({
    groupId: team.groupId,
    name: team.name,
    description: team.description ?? null,
    parentGroupId: team.parentGroupId ?? null,
    leadUserId: team.leadUserId ?? null,
});

const chartNodeToPlain = (node: OrgChartNode): SerializedOrgChartNode => ({
    userId: node.userId,
    displayName: node.displayName,
    avatarUrl: node.avatarUrl ?? null,
    jobTitle: node.jobTitle ?? null,
    department: node.department ?? null,
    managerUserId: node.managerUserId ?? null,
    teams: node.teams.map(teamRefToPlain),
    descendantCount: node.descendantCount,
});

export const fetchPersonThunk = createAsyncThunk(
    'people/fetchPerson',
    async ({ userId }: { userId: string }, { getState, rejectWithValue }) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const person = await peopleApi.getPerson(orgId, userId);
            return personToPlain(person);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to load profile');
        }
    },
);

export interface MyProfileChanges {
    workPhone?: string;
    mobilePhone?: string;
    timezone?: string;
    bio?: string;
    birthday?: string;
    links?: SerializedProfileLink[];
}

export const updateMyProfileThunk = createAsyncThunk(
    'people/updateMyProfile',
    async (changes: MyProfileChanges, { getState, rejectWithValue }) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const person = await peopleApi.updateMyProfile({ organizationId: orgId, ...changes });
            return personToPlain(person);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to update profile');
        }
    },
);

export interface PersonProfileChanges {
    jobTitle?: string;
    department?: string;
    officeLocation?: string;
    workPhone?: string;
    mobilePhone?: string;
    startDateMs?: number | null;
}

export const updatePersonProfileThunk = createAsyncThunk(
    'people/updatePersonProfile',
    async (
        { userId, changes }: { userId: string; changes: PersonProfileChanges },
        { getState, rejectWithValue },
    ) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const { startDateMs, ...fields } = changes;
            const person = await peopleApi.updatePersonProfile({
                organizationId: orgId,
                userId,
                ...fields,
                startDate:
                    startDateMs !== null && startDateMs !== undefined
                        ? timestampFromDate(new Date(startDateMs))
                        : undefined,
            });
            return personToPlain(person);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to update profile');
        }
    },
);

export const setManagerThunk = createAsyncThunk(
    'people/setManager',
    async (
        { userId, managerUserId }: { userId: string; managerUserId: string | null },
        { getState, rejectWithValue },
    ) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const person = await peopleApi.setManager(orgId, userId, managerUserId);
            return personToPlain(person);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to set manager');
        }
    },
);

export const fetchProfilePolicyThunk = createAsyncThunk(
    'people/fetchProfilePolicy',
    async (_: void, { getState, rejectWithValue }) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const response = await peopleApi.getProfilePolicy(orgId);
            return {
                directoryEnabled: response.policy?.directoryEnabled ?? true,
                orgChartEnabled: response.policy?.orgChartEnabled ?? true,
            };
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to load policy');
        }
    },
);

export const fetchOrgChartThunk = createAsyncThunk(
    'people/fetchOrgChart',
    async (_: void, { getState, rejectWithValue }) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const response = await peopleApi.getOrgChart(orgId);
            return {
                nodes: response.nodes.map(chartNodeToPlain),
                rootUserIds: [...response.rootUserIds],
                teams: response.teams.map(teamNodeToPlain),
                truncated: response.truncated,
                enabled: response.enabled,
            };
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to load org chart');
        }
    },
);

export const fetchTeamThunk = createAsyncThunk(
    'people/fetchTeam',
    async ({ groupId }: { groupId: string }, { getState, rejectWithValue }) => {
        try {
            const orgId = getOrgId(getState() as RootState);
            const response = await peopleApi.getTeam(orgId, groupId);
            if (!response.team) throw new Error('team missing in GetTeam response');
            return {
                team: teamNodeToPlain(response.team),
                memberUserIds: [...response.memberUserIds],
            };
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to load team');
        }
    },
);
