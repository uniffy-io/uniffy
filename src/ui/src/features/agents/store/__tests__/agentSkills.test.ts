import { describe, expect, it, vi } from 'vitest';
import type { SkillInfo } from '@uniffy/proto/agents/v1/skills_pb';
import type { RootState } from '@/app/store';
import { skillToPlain, updateSkill } from '@/features/agents/store/agentSkillsThunks';
import { skillsApi } from '@/features/agents/api/skillsApi';

vi.mock('@/features/agents/api/skillsApi', () => ({
    skillsApi: { updateSkill: vi.fn() },
}));

const skillProto = (over: Partial<SkillInfo> = {}): SkillInfo =>
    ({
        id: 's1',
        organizationId: 'org-1',
        name: 'reporter',
        displayName: 'Reporter',
        description: 'desc',
        content: 'BODY',
        whenToUse: 'weekly',
        requiresTools: ['notes.read_note'],
        requiresContext: ['session'],
        source: 1,
        alwaysActive: false,
        latestVersionNumber: 2,
        activeVersionNumber: 2,
        activeVersionPinned: false,
        ...over,
    }) as unknown as SkillInfo;

describe('skillToPlain', () => {
    it('carries the fields needed to seed a manual edit draft', () => {
        const plain = skillToPlain(skillProto());
        expect(plain.content).toBe('BODY');
        expect(plain.whenToUse).toBe('weekly');
        expect(plain.requiresTools).toEqual(['notes.read_note']);
        expect(plain.requiresContext).toEqual(['session']);
        expect(plain.alwaysActive).toBe(false);
    });

    it('copies repeated fields into new arrays (no proto aliasing)', () => {
        const proto = skillProto();
        const plain = skillToPlain(proto);
        expect(plain.requiresTools).not.toBe(proto.requiresTools);
    });
});

describe('updateSkill', () => {
    const getState = () =>
        ({ auth: { currentOrganizationId: 'org-1' } }) as unknown as RootState;

    const runThunk = async (params: Parameters<typeof updateSkill>[0]) => {
        vi.mocked(skillsApi.updateSkill).mockResolvedValue({
            skill: skillProto(),
        } as never);
        await updateSkill(params)(vi.fn(), getState, undefined);
        return vi.mocked(skillsApi.updateSkill).mock.calls.at(-1)?.[0];
    };

    it('sends when_to_use so trigger guidance persists from the detail view', async () => {
        const request = await runThunk({ skillId: 's1', whenToUse: 'when the report is due' });
        expect(request).toEqual({
            organizationId: 'org-1',
            skillId: 's1',
            whenToUse: 'when the report is due',
        });
    });

    it('renames through display_name and never sends the immutable slug', async () => {
        const request = await runThunk({ skillId: 's1', displayName: 'Weekly Report' });
        expect(request).toEqual({
            organizationId: 'org-1',
            skillId: 's1',
            displayName: 'Weekly Report',
        });
        expect(request).not.toHaveProperty('name');
    });
});
