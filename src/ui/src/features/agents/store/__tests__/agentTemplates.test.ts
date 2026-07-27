import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { AgentTemplateSchema } from '@uniffy/proto/agents/v1/agents_pb';
import {
    agentTemplatesReducer,
    selectAgentTemplates,
    selectAgentTemplatesLoaded,
    selectAgentTemplatesLoading,
} from '@/features/agents/store/agentTemplatesSlice';
import {
    fetchAgentTemplates,
    templateToPlain,
} from '@/features/agents/store/agentTemplatesThunks';

const assistant = {
    key: 'assistant',
    name: 'Assistant',
    emoji: 'A',
    description: 'Finds and organizes workspace content.',
    soulPrompt: 'You are the workspace assistant.',
    enabledTools: ['search.query'],
    enabledSkillIds: ['skill-1'],
};

describe('templateToPlain', () => {
    it('copies repeated fields instead of aliasing the proto message', () => {
        const message = create(AgentTemplateSchema, assistant);
        const plain = templateToPlain(message);

        expect(plain).toEqual(assistant);
        expect(plain.enabledTools).not.toBe(message.enabledTools);
        expect(plain.enabledSkillIds).not.toBe(message.enabledSkillIds);
    });
});

describe('agentTemplates slice', () => {
    it('stores fetched templates in server order', () => {
        const templates = [assistant, { ...assistant, key: 'planner', name: 'Planner' }];
        const state = agentTemplatesReducer(
            undefined,
            fetchAgentTemplates.fulfilled(templates, 'req'),
        );

        expect(selectAgentTemplates({ agentTemplates: state } as never)).toEqual(templates);
        expect(selectAgentTemplatesLoaded({ agentTemplates: state } as never)).toBe(true);
        expect(selectAgentTemplatesLoading({ agentTemplates: state } as never)).toBe(false);
    });

    it('marks the fetch loaded on failure so the gallery stops waiting', () => {
        const pending = agentTemplatesReducer(undefined, fetchAgentTemplates.pending('req'));
        expect(pending.loading).toBe(true);
        expect(pending.loaded).toBe(false);

        const failed = agentTemplatesReducer(
            pending,
            fetchAgentTemplates.rejected(new Error('nope'), 'req', undefined, 'denied'),
        );
        expect(failed.loading).toBe(false);
        expect(failed.loaded).toBe(true);
        expect(failed.error).toBe('denied');
        expect(failed.templates).toEqual([]);
    });
});
