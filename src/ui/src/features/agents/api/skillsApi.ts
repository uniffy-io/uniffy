import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { SkillsService } from '@uniffy/proto/agents/v1/skills_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    CreateSkillRequest,
    GetSkillRequest,
    ListSkillsRequest,
    UpdateSkillRequest,
    DeleteSkillRequest,
} from '@uniffy/proto/agents/v1/skills_pb';

const client = createClient(SkillsService, transport);

export const skillsApi = {
    createSkill: async (request: PartialMessage<CreateSkillRequest>) => {
        return client.createSkill(request);
    },
    getSkill: async (request: PartialMessage<GetSkillRequest>) => {
        return client.getSkill(request);
    },
    listSkills: async (request: PartialMessage<ListSkillsRequest>) => {
        return client.listSkills(request);
    },
    updateSkill: async (request: PartialMessage<UpdateSkillRequest>) => {
        return client.updateSkill(request);
    },
    deleteSkill: async (request: PartialMessage<DeleteSkillRequest>) => {
        return client.deleteSkill(request);
    },
};
