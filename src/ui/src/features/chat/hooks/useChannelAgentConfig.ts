/** Per-(channel, agent) model + parameter overrides for agent DMs. */

import { useCallback, useEffect, useState } from 'react';
import { useAppSelector } from '@/app/hooks';
import { chatApi } from '@/features/chat/api/chatApi';
import { friendlyErrorMessage } from '@/config';
import { toast } from 'sonner';
import {
    parseModelParamValues,
    type ModelParamValues,
} from '@/features/agents/utils/modelParamsSchema';

export interface ChannelAgentConfigState {
    modelOverride: string | null;
    modelParams: ModelParamValues;
}

/** Absent field = leave unchanged; null model / empty params = clear the override. */
export interface ChannelAgentConfigChanges {
    modelOverride?: string | null;
    modelParams?: ModelParamValues;
}

export interface ChannelAgentConfigIds {
    organizationId: string;
    channelId: string;
    agentId: string;
}

export interface UseChannelAgentConfigResult {
    config: ChannelAgentConfigState | null;
    loading: boolean;
    updating: boolean;
    update: (changes: ChannelAgentConfigChanges) => Promise<void>;
}

export const configFromProto = (
    proto: { modelOverride: string; modelParamsOverride: string } | undefined,
): ChannelAgentConfigState => ({
    modelOverride: proto?.modelOverride ? proto.modelOverride : null,
    modelParams: parseModelParamValues(proto?.modelParamsOverride ?? ''),
});

export const applyConfigChanges = (
    config: ChannelAgentConfigState,
    changes: ChannelAgentConfigChanges,
): ChannelAgentConfigState => ({
    modelOverride:
        changes.modelOverride !== undefined ? changes.modelOverride : config.modelOverride,
    modelParams: changes.modelParams !== undefined ? changes.modelParams : config.modelParams,
});

/** Wire contract on the optional update fields: absent = unchanged, "" = clear. */
export const buildUpdatePayload = (
    changes: ChannelAgentConfigChanges,
): { modelOverride?: string; modelParamsOverride?: string } => {
    const payload: { modelOverride?: string; modelParamsOverride?: string } = {};
    if (changes.modelOverride !== undefined) {
        payload.modelOverride = changes.modelOverride ?? '';
    }
    if (changes.modelParams !== undefined) {
        payload.modelParamsOverride =
            Object.keys(changes.modelParams).length > 0 ? JSON.stringify(changes.modelParams) : '';
    }
    return payload;
};

const notifyRequestError = (error: unknown): void => {
    const friendly = friendlyErrorMessage(error instanceof Error ? error.message : String(error));
    if (friendly) toast.error(friendly);
};

export const fetchChannelAgentConfig = async (
    ids: ChannelAgentConfigIds,
): Promise<ChannelAgentConfigState> => {
    const response = await chatApi.getChannelAgentConfig(ids);
    return configFromProto(response.config);
};

/** Applies optimistically, reconciles with the server row, reverts + toasts on failure. */
export const runConfigUpdate = async (
    ids: ChannelAgentConfigIds,
    current: ChannelAgentConfigState,
    changes: ChannelAgentConfigChanges,
    setConfig: (next: ChannelAgentConfigState) => void,
): Promise<void> => {
    const payload = buildUpdatePayload(changes);
    if (Object.keys(payload).length === 0) return;
    setConfig(applyConfigChanges(current, changes));
    try {
        const response = await chatApi.updateChannelAgentConfig({ ...ids, ...payload });
        if (response.config) setConfig(configFromProto(response.config));
    } catch (error) {
        setConfig(current);
        notifyRequestError(error);
    }
};

export function useChannelAgentConfig(
    channelId: string | undefined,
    agentId: string | undefined,
): UseChannelAgentConfigResult {
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId ?? '');
    const [config, setConfig] = useState<ChannelAgentConfigState | null>(null);
    const [loading, setLoading] = useState(false);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        setConfig(null);
        if (!channelId || !agentId || !organizationId) return;
        let cancelled = false;
        const load = async (): Promise<void> => {
            setLoading(true);
            try {
                const state = await fetchChannelAgentConfig({ organizationId, channelId, agentId });
                if (!cancelled) setConfig(state);
            } catch (error) {
                if (!cancelled) notifyRequestError(error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [channelId, agentId, organizationId]);

    const update = useCallback(
        async (changes: ChannelAgentConfigChanges): Promise<void> => {
            if (!channelId || !agentId || !organizationId || !config) return;
            setUpdating(true);
            try {
                await runConfigUpdate(
                    { organizationId, channelId, agentId },
                    config,
                    changes,
                    setConfig,
                );
            } finally {
                setUpdating(false);
            }
        },
        [channelId, agentId, organizationId, config],
    );

    return { config, loading, updating, update };
}
