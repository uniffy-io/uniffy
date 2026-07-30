import { describe, expect, it } from 'vitest';
import {
    agentsUiReducer,
    selectLastSection,
    selectSidebarCollapsed,
    setLastSection,
    setSidebarCollapsed,
    toggleSidebar,
} from '@/features/agents/store/agentsUiSlice';
import type { RootState } from '@/app/store';

function stateWith(agentsUi: Record<string, unknown>): RootState {
    return { agentsUi } as unknown as RootState;
}

describe('selectLastSection', () => {
    it('returns live sections unchanged', () => {
        expect(selectLastSection(stateWith({ lastSection: 'agents' }))).toBe('agents');
        expect(selectLastSection(stateWith({ lastSection: 'skills' }))).toBe('skills');
        expect(selectLastSection(stateWith({ lastSection: 'automations' }))).toBe('automations');
    });

    it('falls back to agents for stale persisted values', () => {
        expect(selectLastSection(stateWith({ lastSection: 'usage' }))).toBe('agents');
        expect(selectLastSection(stateWith({ lastSection: 'chat' }))).toBe('agents');
        expect(selectLastSection(stateWith({ lastSection: undefined }))).toBe('agents');
    });
});

describe('agentsUiSlice reducers', () => {
    it('tracks the last-visited section', () => {
        const state = agentsUiReducer(undefined, setLastSection('automations'));
        expect(state.lastSection).toBe('automations');
    });

    it('toggles sidebar collapse', () => {
        const collapsed = agentsUiReducer(undefined, toggleSidebar());
        expect(collapsed.sidebarCollapsed).toBe(true);
        expect(agentsUiReducer(collapsed, toggleSidebar()).sidebarCollapsed).toBe(false);
    });

    it('sets sidebar collapse explicitly', () => {
        const state = agentsUiReducer(undefined, setSidebarCollapsed(true));
        expect(selectSidebarCollapsed(stateWith(state))).toBe(true);
        expect(selectSidebarCollapsed(stateWith(agentsUiReducer(state, setSidebarCollapsed(false))))).toBe(false);
    });
});
