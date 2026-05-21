/**
 * Action catalogue helper tests (label + colour + domain inference).
 */

import { describe, expect, it } from 'vitest';
import {
    actionDomain,
    actionDomainColor,
    actionLabel,
} from '@/features/admin/pages/audit/actionCatalog';

describe('actionDomain', () => {
    it('returns the dotted prefix for known actions', () => {
        expect(actionDomain('auth.login_success')).toBe('auth');
        expect(actionDomain('chat_channel.archived')).toBe('chat_channel');
    });

    it('collapses dynamic tool-call actions onto the agent domain', () => {
        expect(actionDomain('agent.tool_call.notes.create_note')).toBe('agent');
    });

    it('returns an empty string for malformed input', () => {
        expect(actionDomain('')).toBe('');
    });
});

describe('actionDomainColor', () => {
    it('maps each known domain onto a non-empty class string', () => {
        expect(actionDomainColor('auth.login_success').length).toBeGreaterThan(0);
        expect(actionDomainColor('note.deleted').length).toBeGreaterThan(0);
        expect(actionDomainColor('agent.tool_call.x')).toEqual(
            actionDomainColor('agent.created'),
        );
    });

    it('falls back to a muted class for unknown domains', () => {
        const unknown = actionDomainColor('made_up.thing');
        expect(unknown).toMatch(/muted/);
    });
});

describe('actionLabel', () => {
    it('formats a known action with its group label', () => {
        expect(actionLabel('note.deleted')).toBe('Notes: Deleted');
    });

    it('formats dynamic tool-call actions with the tool name', () => {
        expect(actionLabel('agent.tool_call.notes.create_note')).toBe(
            'Agents: Tool call · notes.create_note',
        );
    });

    it('falls back to the raw string for fully unknown actions', () => {
        expect(actionLabel('mystery.event')).toBe('mystery.event');
    });
});
