import { MemoryScope } from "@uniffy/proto/agents/v1/memories_pb";
import type { SerializedModelInfo } from "@/features/agents/store/agentProvidersThunks";
import type { MemoryScopeSubject } from "@/features/agents/store/agentMemoriesThunks";
import {
  parseModelParamsSchema,
  stripInvalidParams,
  type ModelParamValues,
} from "@/features/agents/utils/modelParamsSchema";
import type { ChannelAgentConfigState } from "@/features/chat/hooks/useChannelAgentConfig";

// Curated catalog chat models only - keeps live-API noise (whisper, realtime,
// embeddings, image-only) out of the picker.
export const filterChatModels = (models: SerializedModelInfo[]): SerializedModelInfo[] =>
  models.filter((m) => m.catalogKnown && !m.supportsImageGeneration);

export const modelDisplayName = (models: SerializedModelInfo[], modelId: string): string =>
  models.find((m) => m.id === modelId)?.displayName || modelId;

export const resolveEffectiveModelId = (
  config: Pick<ChannelAgentConfigState, "modelOverride"> | null,
  primaryModel: string,
): string => config?.modelOverride || primaryModel;

export const pickerButtonLabel = (
  config: Pick<ChannelAgentConfigState, "modelOverride"> | null,
  primaryModel: string,
  models: SerializedModelInfo[],
): string =>
  config?.modelOverride
    ? modelDisplayName(models, config.modelOverride)
    : `Default (${modelDisplayName(models, primaryModel)})`;

/** Keeps a stale override visible even if the key/catalog no longer lists it. */
export const buildModelOptions = (
  chatModels: SerializedModelInfo[],
  modelOverride: string | null,
): Array<{ id: string; label: string }> => {
  const options = chatModels.map((m) => ({ id: m.id, label: m.displayName || m.id }));
  if (modelOverride && !chatModels.some((m) => m.id === modelOverride)) {
    options.unshift({ id: modelOverride, label: modelOverride });
  }
  return options;
};

export const paramsForModelSwitch = (
  nextSchemaJson: string,
  current: ModelParamValues,
): ModelParamValues => stripInvalidParams(parseModelParamsSchema(nextSchemaJson), current);

/**
 * Params to send alongside a model switch, mirroring the backend: stored
 * params are stripped per the next effective model, but when that model has no
 * client-visible schema (name-only agent on the org default, stale list) they
 * are left untouched and the backend strips per the real effective model.
 * `undefined` = omit the field from the update.
 */
export const paramsChangesForModelSwitch = (
  models: SerializedModelInfo[],
  nextModelId: string | null,
  primaryModel: string,
  current: ModelParamValues,
): ModelParamValues | undefined => {
  if (Object.keys(current).length === 0) return undefined;
  const nextId = nextModelId ?? primaryModel;
  const nextSchemaJson = models.find((m) => m.id === nextId)?.parameterSchemaJson ?? "";
  if (!nextSchemaJson) return undefined;
  return paramsForModelSwitch(nextSchemaJson, current);
};

/**
 * Mirrors the backend's memory scope routing: a 1:1 agent DM is a personal
 * surface (the caller's own memories with this agent); everything else is
 * channel-shared.
 */
export const memoryScopeForChannel = (
  channel: { isAgentDm?: boolean; channelType?: string } | undefined,
  channelId: string,
): MemoryScopeSubject =>
  channel?.isAgentDm && channel.channelType === "DIRECT"
    ? { scope: MemoryScope.USER }
    : { scope: MemoryScope.CHANNEL, subjectId: channelId };
