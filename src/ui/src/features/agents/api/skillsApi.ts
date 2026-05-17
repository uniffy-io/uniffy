import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import {
    SkillsService,
    CreateSkillRequestSchema,
    GetSkillRequestSchema,
    ListSkillsRequestSchema,
    UpdateSkillRequestSchema,
    DeleteSkillRequestSchema,
} from '@uniffy/proto/agents/v1/skills_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(SkillsService, unaryTransport);

export const skillsApi = {
    createSkill: async (request: MessageInitShape<typeof CreateSkillRequestSchema>) => {
        return client.createSkill(request);
    },
    getSkill: async (request: MessageInitShape<typeof GetSkillRequestSchema>) => {
        return client.getSkill(request);
    },
    listSkills: async (request: MessageInitShape<typeof ListSkillsRequestSchema>) => {
        return client.listSkills(request);
    },
    updateSkill: async (request: MessageInitShape<typeof UpdateSkillRequestSchema>) => {
        return client.updateSkill(request);
    },
    deleteSkill: async (request: MessageInitShape<typeof DeleteSkillRequestSchema>) => {
        return client.deleteSkill(request);
    },
};
