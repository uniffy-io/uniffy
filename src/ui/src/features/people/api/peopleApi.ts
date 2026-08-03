import { createClient } from '@connectrpc/connect';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { unaryTransport } from '@/config/api';
import { PeopleService } from '@uniffy/proto/people/v1/people_pb';
import type {
    GetOrgChartResponse,
    GetProfilePolicyResponse,
    GetTeamResponse,
    IdentitySource,
    IdentitySourceKind,
    ListTeamsResponse,
    PersonProfile,
    UpdateProfilePolicyResponse,
} from '@uniffy/proto/people/v1/people_pb';

const peopleClient = createClient(PeopleService, unaryTransport);

export const peopleApi = {
    getPerson: async (organizationId: string, userId: string): Promise<PersonProfile> => {
        const response = await peopleClient.getPerson({ organizationId, userId });
        if (!response.person) throw new Error('person missing in GetPerson response');
        return response.person;
    },

    updateMyProfile: async (params: {
        organizationId: string;
        workPhone?: string;
        mobilePhone?: string;
        timezone?: string;
        bio?: string;
        birthday?: string;
        links?: { label: string; url: string }[];
    }): Promise<PersonProfile> => {
        const { links, ...fields } = params;
        const response = await peopleClient.updateMyProfile({
            ...fields,
            links: links ? { links } : undefined,
        });
        if (!response.person) throw new Error('person missing in UpdateMyProfile response');
        return response.person;
    },

    updatePersonProfile: async (params: {
        organizationId: string;
        userId: string;
        jobTitle?: string;
        department?: string;
        officeLocation?: string;
        workPhone?: string;
        mobilePhone?: string;
        startDate?: Timestamp;
    }): Promise<PersonProfile> => {
        const response = await peopleClient.updatePersonProfile(params);
        if (!response.person) throw new Error('person missing in UpdatePersonProfile response');
        return response.person;
    },

    setManager: async (
        organizationId: string,
        userId: string,
        managerUserId: string | null,
    ): Promise<PersonProfile> => {
        const response = await peopleClient.setManager({
            organizationId,
            userId,
            managerUserId: managerUserId ?? undefined,
        });
        if (!response.person) throw new Error('person missing in SetManager response');
        return response.person;
    },

    getProfilePolicy: async (organizationId: string): Promise<GetProfilePolicyResponse> => {
        return peopleClient.getProfilePolicy({ organizationId });
    },

    updateProfilePolicy: async (
        organizationId: string,
        policy: { directoryEnabled: boolean; orgChartEnabled: boolean },
    ): Promise<UpdateProfilePolicyResponse> => {
        return peopleClient.updateProfilePolicy({ organizationId, policy });
    },

    listTeams: async (organizationId: string): Promise<ListTeamsResponse> => {
        return peopleClient.listTeams({ organizationId });
    },

    listIdentitySources: async (organizationId: string): Promise<IdentitySource[]> => {
        const response = await peopleClient.listIdentitySources({ organizationId });
        return response.sources;
    },

    createIdentitySource: async (params: {
        organizationId: string;
        kind: IdentitySourceKind;
        name: string;
        configJson: string;
        secret?: string;
    }): Promise<IdentitySource> => {
        const response = await peopleClient.createIdentitySource(params);
        if (!response.source) throw new Error('source missing in CreateIdentitySource response');
        return response.source;
    },

    updateIdentitySource: async (params: {
        organizationId: string;
        sourceId: string;
        name?: string;
        isActive?: boolean;
        configJson?: string;
        secret?: string;
    }): Promise<IdentitySource> => {
        const response = await peopleClient.updateIdentitySource(params);
        if (!response.source) throw new Error('source missing in UpdateIdentitySource response');
        return response.source;
    },

    deleteIdentitySource: async (organizationId: string, sourceId: string): Promise<void> => {
        await peopleClient.deleteIdentitySource({ organizationId, sourceId });
    },

    triggerDirectorySync: async (organizationId: string, sourceId: string): Promise<boolean> => {
        const response = await peopleClient.triggerDirectorySync({ organizationId, sourceId });
        return response.enqueued;
    },

    getOrgChart: async (organizationId: string): Promise<GetOrgChartResponse> => {
        return peopleClient.getOrgChart({ organizationId });
    },

    getTeam: async (organizationId: string, groupId: string): Promise<GetTeamResponse> => {
        return peopleClient.getTeam({ organizationId, groupId });
    },
};
