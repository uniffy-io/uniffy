import { describe, expect, it } from 'vitest';
import { friendlyErrorMessage } from '@/config/errorMessages';
import { parseSkillNameConflict } from '@/features/agents/utils/skillDraftErrors';

const CONFLICT =
    "[invalid_argument] Validation error on 'skill_name_conflict': A skill named 'Weekly Report' " +
    "already uses the identifier 'weekly-report'. Saving this draft replaces its content with a " +
    'new version.';

describe('parseSkillNameConflict', () => {
    it('reads the existing skill name off the refusal', () => {
        expect(parseSkillNameConflict(CONFLICT)).toEqual({ existingSkillName: 'Weekly Report' });
        expect(parseSkillNameConflict(new Error(CONFLICT))).toEqual({
            existingSkillName: 'Weekly Report',
        });
    });

    it('returns null for every other rejection', () => {
        expect(parseSkillNameConflict("[invalid_argument] Validation error on 'name': too long")).toBeNull();
        expect(parseSkillNameConflict(undefined)).toBeNull();
    });

    it('suppresses the generic toast so only the confirmation renders', () => {
        expect(friendlyErrorMessage(CONFLICT)).toBeNull();
    });
});
