import { describe, expect, it } from 'vitest';
import { GroupKind } from '@uniffy/proto/common/v1/common_pb';
import { SUBJECT_TYPE, type Subject } from '@/components/subject/types';
import { partitionSubjects, subjectKindFromGroupKind } from '@/components/subject/utils';

function user(id: string): Subject {
    return { id, type: SUBJECT_TYPE.USER, name: `User ${id}` };
}

function group(id: string, kind?: Subject['kind']): Subject {
    return { id, type: SUBJECT_TYPE.GROUP, name: `Group ${id}`, kind };
}

describe('partitionSubjects', () => {
    it('sections people, teams and groups in that order', () => {
        const sections = partitionSubjects([
            group('g1', 'access'),
            user('u1'),
            group('t1', 'team'),
            user('u2'),
            group('t2', 'team'),
        ]);

        expect(sections.map((s) => s.label)).toEqual(['People', 'Teams', 'Groups']);
        expect(sections[0].subjects.map((s) => s.id)).toEqual(['u1', 'u2']);
        expect(sections[1].subjects.map((s) => s.id)).toEqual(['t1', 't2']);
        expect(sections[2].subjects.map((s) => s.id)).toEqual(['g1']);
    });

    it('drops empty sections', () => {
        expect(partitionSubjects([user('u1')]).map((s) => s.label)).toEqual(['People']);
        expect(partitionSubjects([group('t1', 'team')]).map((s) => s.label)).toEqual(['Teams']);
        expect(partitionSubjects([])).toEqual([]);
    });

    it('treats a group without a kind as an access group', () => {
        const sections = partitionSubjects([group('g1')]);
        expect(sections.map((s) => s.label)).toEqual(['Groups']);
    });
});

describe('subjectKindFromGroupKind', () => {
    it('maps TEAM to team and everything else to access', () => {
        expect(subjectKindFromGroupKind(GroupKind.TEAM)).toBe('team');
        expect(subjectKindFromGroupKind(GroupKind.ACCESS)).toBe('access');
        expect(subjectKindFromGroupKind(GroupKind.UNSPECIFIED)).toBe('access');
    });
});
