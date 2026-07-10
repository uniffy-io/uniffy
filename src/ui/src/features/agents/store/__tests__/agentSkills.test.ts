import { describe, expect, it } from 'vitest';
import type { SkillInfo } from '@uniffy/proto/agents/v1/skills_pb';
import { skillToPlain } from '@/features/agents/store/agentSkillsThunks';

const skillProto = (over: Partial<SkillInfo> = {}): SkillInfo =>
    ({
        id: 's1',
        organizationId: 'org-1',
        ownerId: 'user-1',
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
