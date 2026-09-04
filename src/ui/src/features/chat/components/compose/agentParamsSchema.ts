import type { SerializedModelInfo } from "@/features/agents/store/agentProvidersThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { IMAGE_GENERATION_TOOL } from "@/features/agents/config/toolCatalog";
import { resolveEffectiveModelId } from "@/features/chat/components/compose/agentModelSelection";
import type { ChannelAgentConfigState } from "@/features/chat/hooks/useChannelAgentConfig";

export const hasParamsOverride = (config: ChannelAgentConfigState | null): boolean =>
  Object.keys(config?.modelParams ?? {}).length > 0 ||
  Object.keys(config?.imageParams ?? {}).length > 0;

/** The agent's image model generates nothing here unless the tool is enabled. */
export const imageSchemaFor = (
  models: SerializedModelInfo[],
  agent: Pick<SerializedAgent, "enabledTools" | "imageModel">,
): { schemaJson: string; estimatesJson: string } => {
  if (!agent.imageModel || !agent.enabledTools.includes(IMAGE_GENERATION_TOOL)) {
    return { schemaJson: "", estimatesJson: "" };
  }
  const model = models.find((m) => m.id === agent.imageModel);
  return {
    schemaJson: model?.imageParameterSchemaJson ?? "",
    estimatesJson: model?.imagePriceEstimatesJson ?? "",
  };
};

/** Schema of the model the conversation actually runs on (override else agent primary). */
export const effectiveParamsSchemaJson = (
  models: SerializedModelInfo[],
  config: Pick<ChannelAgentConfigState, "modelOverride"> | null,
  primaryModel: string,
): string => {
  const effectiveId = resolveEffectiveModelId(config, primaryModel);
  return models.find((m) => m.id === effectiveId)?.parameterSchemaJson ?? "";
};
