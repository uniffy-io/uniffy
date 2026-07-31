import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    getChannelAgentConfig: vi.fn(),
    updateChannelAgentConfig: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('@/features/chat/api/chatApi', () => ({
    chatApi: {
        getChannelAgentConfig: mocks.getChannelAgentConfig,
        updateChannelAgentConfig: mocks.updateChannelAgentConfig,
    },
}));

vi.mock('@/config', () => ({
    friendlyErrorMessage: (message: string) => message,
}));

vi.mock('sonner', () => ({
    toast: { error: mocks.toastError },
}));

import {
    applyConfigChanges,
    buildUpdatePayload,
    configFromProto,
    fetchChannelAgentConfig,
    runConfigUpdate,
    type ChannelAgentConfigState,
} from '@/features/chat/hooks/useChannelAgentConfig';

const ids = { organizationId: 'org-1', channelId: 'ch-1', agentId: 'ag-1' };

function config(overrides: Partial<ChannelAgentConfigState> = {}): ChannelAgentConfigState {
    return { modelOverride: null, modelParams: {}, imageParams: {}, ...overrides };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('configFromProto', () => {
    it('maps empty wire strings to no-override state', () => {
        expect(
            configFromProto({ modelOverride: '', modelParamsOverride: '', imageParamsOverride: '' }),
        ).toEqual({ modelOverride: null, modelParams: {}, imageParams: {} });
    });

    it('maps set values through', () => {
        expect(
            configFromProto({
                modelOverride: 'gpt-x',
                modelParamsOverride: '{"temperature":0.2}',
                imageParamsOverride: '{"aspect_ratio":"16:9"}',
            }),
        ).toEqual({
            modelOverride: 'gpt-x',
            modelParams: { temperature: 0.2 },
            imageParams: { aspect_ratio: '16:9' },
        });
    });

    it('treats a missing proto as no overrides', () => {
        expect(configFromProto(undefined)).toEqual({
            modelOverride: null,
            modelParams: {},
            imageParams: {},
        });
    });

    it('ignores malformed params JSON', () => {
        expect(
            configFromProto({
                modelOverride: '',
                modelParamsOverride: 'not-json',
                imageParamsOverride: '',
            }).modelParams,
        ).toEqual({});
    });
});

describe('buildUpdatePayload', () => {
    it('omits absent fields entirely', () => {
        expect(buildUpdatePayload({})).toEqual({});
        const payload = buildUpdatePayload({ modelOverride: 'claude-x' });
        expect(payload).toEqual({ modelOverride: 'claude-x' });
        expect('modelParamsOverride' in payload).toBe(false);
    });

    it('maps a null model override to the empty-string clear', () => {
        expect(buildUpdatePayload({ modelOverride: null })).toEqual({ modelOverride: '' });
    });

    it('serializes params and clears them with the empty string', () => {
        expect(buildUpdatePayload({ modelParams: { temperature: 1 } })).toEqual({
            modelParamsOverride: '{"temperature":1}',
        });
        expect(buildUpdatePayload({ modelParams: {} })).toEqual({ modelParamsOverride: '' });
    });

    it('carries both fields when both change', () => {
        expect(
            buildUpdatePayload({ modelOverride: 'm-1', modelParams: { reasoning_effort: 'high' } }),
        ).toEqual({
            modelOverride: 'm-1',
            modelParamsOverride: '{"reasoning_effort":"high"}',
        });
    });
});

describe('applyConfigChanges', () => {
    it('leaves absent fields untouched', () => {
        const current = config({ modelOverride: 'm-1', modelParams: { temperature: 0.5 } });
        expect(applyConfigChanges(current, { modelParams: { temperature: 1 } })).toEqual({
            modelOverride: 'm-1',
            modelParams: { temperature: 1 },
            imageParams: {},
        });
        expect(applyConfigChanges(current, { modelOverride: null })).toEqual({
            modelOverride: null,
            modelParams: { temperature: 0.5 },
            imageParams: {},
        });
    });
});

describe('fetchChannelAgentConfig', () => {
    it('fetches by ids and maps the proto config', async () => {
        mocks.getChannelAgentConfig.mockResolvedValue({
            config: {
                modelOverride: 'm-2',
                modelParamsOverride: '{"top_p":0.9}',
                imageParamsOverride: '',
            },
        });
        const state = await fetchChannelAgentConfig(ids);
        expect(mocks.getChannelAgentConfig).toHaveBeenCalledWith(ids);
        expect(state).toEqual({
            modelOverride: 'm-2',
            modelParams: { top_p: 0.9 },
            imageParams: {},
        });
    });
});

describe('runConfigUpdate', () => {
    it('applies optimistically then reconciles with the server row', async () => {
        mocks.updateChannelAgentConfig.mockResolvedValue({
            config: { modelOverride: 'served-model', modelParamsOverride: '' },
        });
        const setConfig = vi.fn();
        const current = config({ modelParams: { temperature: 0.5 } });

        await runConfigUpdate(ids, current, { modelOverride: 'picked-model' }, setConfig);

        expect(setConfig).toHaveBeenNthCalledWith(1, {
            modelOverride: 'picked-model',
            modelParams: { temperature: 0.5 },
            imageParams: {},
        });
        expect(setConfig).toHaveBeenNthCalledWith(2, {
            modelOverride: 'served-model',
            modelParams: {},
            imageParams: {},
        });
    });

    it('sends only the changed fields on the wire', async () => {
        mocks.updateChannelAgentConfig.mockResolvedValue({ config: undefined });
        await runConfigUpdate(ids, config(), { modelParams: { temperature: 1 } }, vi.fn());

        expect(mocks.updateChannelAgentConfig).toHaveBeenCalledTimes(1);
        const request = mocks.updateChannelAgentConfig.mock.calls[0][0];
        expect(request).toEqual({ ...ids, modelParamsOverride: '{"temperature":1}' });
        expect('modelOverride' in request).toBe(false);
    });

    it('is a no-op when nothing changed', async () => {
        const setConfig = vi.fn();
        await runConfigUpdate(ids, config(), {}, setConfig);
        expect(mocks.updateChannelAgentConfig).not.toHaveBeenCalled();
        expect(setConfig).not.toHaveBeenCalled();
    });

    it('reverts the optimistic state and toasts on failure', async () => {
        mocks.updateChannelAgentConfig.mockRejectedValue(new Error('boom'));
        const setConfig = vi.fn();
        const current = config({ modelOverride: 'm-1' });

        await runConfigUpdate(ids, current, { modelOverride: null }, setConfig);

        expect(setConfig).toHaveBeenNthCalledWith(1, {
            modelOverride: null,
            modelParams: {},
            imageParams: {},
        });
        expect(setConfig).toHaveBeenNthCalledWith(2, current);
        expect(mocks.toastError).toHaveBeenCalledWith('boom');
    });
});
