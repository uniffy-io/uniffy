import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import {
    SkillsService,
    CreateSkillRequestSchema,
    CreateSkillDraftRequestSchema,
    DiscardSkillDraftRequestSchema,
    GetSkillRequestSchema,
    GetSkillDraftRequestSchema,
    ListSkillsRequestSchema,
    ListSkillDraftsRequestSchema,
    ListSkillVersionsRequestSchema,
    ListRunnableSkillsRequestSchema,
    GetSkillVersionRequestSchema,
    SetMainSkillVersionRequestSchema,
    RevertSkillRequestSchema,
    SaveSkillDraftRequestSchema,
    GetSkillMetricsRequestSchema,
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
    listRunnableSkills: async (request: MessageInitShape<typeof ListRunnableSkillsRequestSchema>) => {
        return client.listRunnableSkills(request);
    },
    updateSkill: async (request: MessageInitShape<typeof UpdateSkillRequestSchema>) => {
        return client.updateSkill(request);
    },
    deleteSkill: async (request: MessageInitShape<typeof DeleteSkillRequestSchema>) => {
        return client.deleteSkill(request);
    },
    createSkillDraft: async (request: MessageInitShape<typeof CreateSkillDraftRequestSchema>) => {
        return client.createSkillDraft(request);
    },
    getSkillDraft: async (request: MessageInitShape<typeof GetSkillDraftRequestSchema>) => {
        return client.getSkillDraft(request);
    },
    listSkillDrafts: async (request: MessageInitShape<typeof ListSkillDraftsRequestSchema>) => {
        return client.listSkillDrafts(request);
    },
    saveSkillDraft: async (request: MessageInitShape<typeof SaveSkillDraftRequestSchema>) => {
        return client.saveSkillDraft(request);
    },
    discardSkillDraft: async (request: MessageInitShape<typeof DiscardSkillDraftRequestSchema>) => {
        return client.discardSkillDraft(request);
    },
    listSkillVersions: async (request: MessageInitShape<typeof ListSkillVersionsRequestSchema>) => {
        return client.listSkillVersions(request);
    },
    getSkillVersion: async (request: MessageInitShape<typeof GetSkillVersionRequestSchema>) => {
        return client.getSkillVersion(request);
    },
    setMainSkillVersion: async (
        request: MessageInitShape<typeof SetMainSkillVersionRequestSchema>,
    ) => {
        return client.setMainSkillVersion(request);
    },
    revertSkill: async (request: MessageInitShape<typeof RevertSkillRequestSchema>) => {
        return client.revertSkill(request);
    },
    getSkillMetrics: async (request: MessageInitShape<typeof GetSkillMetricsRequestSchema>) => {
        return client.getSkillMetrics(request);
    },
};
