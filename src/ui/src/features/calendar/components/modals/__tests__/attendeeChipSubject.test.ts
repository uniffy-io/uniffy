import { describe, expect, it } from 'vitest';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { attendeeChipSubject } from '@/features/calendar/components/modals/attendeeChipSubject';
import type { Attendee } from '@/features/calendar/types/attendee';

function attendee(overrides: Partial<Attendee> = {}): Attendee {
    return {
        id: 'a1',
        name: 'Engineering',
        email: '',
        initials: 'EN',
        status: 'pending',
        role: 'required',
        ...overrides,
    };
}

describe('attendeeChipSubject', () => {
    it('keeps the group type, kind and member count from the resolved subject', () => {
        const resolved: Subject = {
            id: 'a1',
            type: SUBJECT_TYPE.GROUP,
            name: 'Engineering',
            memberCount: 7,
            kind: 'team',
        };

        const chip = attendeeChipSubject(attendee(), resolved);

        expect(chip.type).toBe(SUBJECT_TYPE.GROUP);
        expect(chip.kind).toBe('team');
        expect(chip.memberCount).toBe(7);
    });

    it('keeps an access group as a group', () => {
        const resolved: Subject = {
            id: 'a1',
            type: SUBJECT_TYPE.GROUP,
            name: 'Release approvers',
            memberCount: 3,
            kind: 'access',
        };

        const chip = attendeeChipSubject(attendee({ name: 'Release approvers' }), resolved);

        expect(chip.type).toBe(SUBJECT_TYPE.GROUP);
        expect(chip.kind).toBe('access');
    });

    it('renders a resolved user with the attendee name and email', () => {
        const resolved: Subject = {
            id: 'a1',
            type: SUBJECT_TYPE.USER,
            name: 'Ada',
            email: 'ada@example.com',
        };

        const chip = attendeeChipSubject(
            attendee({ name: 'Ada Lovelace', email: 'ada@example.com' }),
            resolved,
        );

        expect(chip.type).toBe(SUBJECT_TYPE.USER);
        expect(chip.name).toBe('Ada Lovelace');
        expect(chip.email).toBe('ada@example.com');
    });

    it('falls back to a user chip when the id does not resolve', () => {
        const chip = attendeeChipSubject(
            attendee({ name: '', email: 'ext@example.com' }),
            undefined,
        );

        expect(chip.type).toBe(SUBJECT_TYPE.USER);
        expect(chip.name).toBe('ext@example.com');
    });
});
