import { describe, expect, it } from 'vitest';
import { computeSlashToken } from '@/features/agents/hooks/useTextareaSlash';
import {
    agentRunnableSkillsReducer,
    selectRunnableSkillsForAgent,
} from '@/features/agents/store/agentRunnableSkillsSlice';
import { fetchRunnableSkills } from '@/features/agents/store/agentRunnableSkillsThunks';

const AGENT = 'agent-1';

const skill = (id: string, name: string) => ({
    id,
    name,
    displayName: name,
    description: '',
    whenToUse: '',
});

describe('computeSlashToken', () => {
    it('opens at start of input', () => {
        expect(computeSlashToken('/rep')).toEqual({ start: 0, query: 'rep' });
    });

    it('opens after whitespace', () => {
        expect(computeSlashToken('hello /run')).toEqual({ start: 6, query: 'run' });
    });

    it('does not open mid-word (path or URL)', () => {
        expect(computeSlashToken('https://foo')).toBeNull();
        expect(computeSlashToken('a/b')).toBeNull();
    });

    it('closes once the token has whitespace', () => {
        expect(computeSlashToken('/run now')).toBeNull();
    });

    it('returns null without a slash', () => {
        expect(computeSlashToken('just text')).toBeNull();
    });

    it('tracks an empty query right after the slash', () => {
        expect(computeSlashToken('/')).toEqual({ start: 0, query: '' });
    });
});

describe('agentRunnableSkills slice', () => {
    it('stores fetched skills per agent and exposes them via the selector', () => {
        const skills = [skill('s1', 'daily-report'), skill('s2', 'summarize')];
        const state = agentRunnableSkillsReducer(
            undefined,
            fetchRunnableSkills.fulfilled({ agentId: AGENT, skills }, 'req', { agentId: AGENT }),
        );
        const rootState = { agentRunnableSkills: state } as never;
        expect(selectRunnableSkillsForAgent(AGENT)(rootState)).toHaveLength(2);
        expect(selectRunnableSkillsForAgent('other')(rootState)).toEqual([]);
        expect(selectRunnableSkillsForAgent(undefined)(rootState)).toEqual([]);
    });

    it('tracks the loading agent across pending and clears it on fulfilled', () => {
        const pending = agentRunnableSkillsReducer(
            undefined,
            fetchRunnableSkills.pending('req', { agentId: AGENT }),
        );
        expect(pending.loadingAgentId).toBe(AGENT);

        const done = agentRunnableSkillsReducer(
            pending,
            fetchRunnableSkills.fulfilled({ agentId: AGENT, skills: [] }, 'req', { agentId: AGENT }),
        );
        expect(done.loadingAgentId).toBeNull();
    });
});
