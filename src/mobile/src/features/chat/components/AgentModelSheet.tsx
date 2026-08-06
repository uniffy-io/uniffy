import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Check, Faders } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  useAgentModels,
  useAgentImageModels,
  IMAGE_GENERATION_TOOL,
  type AgentModelOption,
} from "@features/agents/useAgents";
import type { SerializedAgent } from "@features/agents/agentSerializer";
import { ModelParamsSection } from "@features/agents/components/ModelParamsSection";
import {
  parseModelParamValues,
  parseModelParamsSchema,
  stripInvalidParams,
  type ModelParamValues,
} from "@features/agents/modelParamsSchema";
import {
  useChannelAgentConfig,
  useUpdateChannelAgentConfig,
} from "@features/chat/useChannelAgentConfig";

/**
 * Params to send alongside a model switch, mirroring the backend: stored params
 * are stripped per the next effective model, but when that model has no
 * client-visible schema (name-only agent on the org default, stale list) they
 * are left untouched and the backend strips per the real effective model.
 * `undefined` = omit the field from the update.
 */
function paramsForModelSwitch(
  models: AgentModelOption[],
  nextModelId: string,
  primaryModel: string,
  current: ModelParamValues,
): ModelParamValues | undefined {
  if (Object.keys(current).length === 0) return undefined;
  const nextId = nextModelId || primaryModel;
  const schemaJson = models.find((m) => m.id === nextId)?.parameterSchemaJson ?? "";
  if (!schemaJson) return undefined;
  return stripInvalidParams(parseModelParamsSchema(schemaJson), current);
}

export function AgentModelSheet({
  visible,
  T,
  channelId,
  agent,
  onClose,
}: {
  visible: boolean;
  T: ThemeColors;
  channelId: string;
  agent: SerializedAgent | undefined;
  onClose: () => void;
}) {
  const agentId = agent?.id ?? "";
  // Loaded as soon as the agent DM opens, not on sheet open: the sheet is
  // mounted for the whole chat, so waiting for `visible` shows an empty list first.
  const configQuery = useChannelAgentConfig(channelId, agentId, !!agentId);
  const update = useUpdateChannelAgentConfig(channelId, agentId);
  const modelsQuery = useAgentModels(agent?.primaryProviderKeyId ?? "", !!agentId);

  // The image tool has to be on for the agent's image model to generate
  // anything here, so there is nothing to tune when it is off.
  const imageEnabled = !!agent?.imageModel && !!agent?.enabledTools.includes(IMAGE_GENERATION_TOOL);
  const imageModelsQuery = useAgentImageModels(agent?.imageProviderKeyId ?? "", imageEnabled);

  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data]);
  const config = configQuery.data;
  const modelOverride = config?.modelOverride ?? "";
  const effectiveModelId = modelOverride || agent?.primaryModel || "";

  const schemaJson = useMemo(
    () => models.find((m) => m.id === effectiveModelId)?.parameterSchemaJson ?? "",
    [models, effectiveModelId],
  );
  const imageSchemaJson = useMemo(() => {
    if (!imageEnabled) return "";
    return (
      (imageModelsQuery.data ?? []).find((m) => m.id === agent?.imageModel)
        ?.imageParameterSchemaJson ?? ""
    );
  }, [imageEnabled, imageModelsQuery.data, agent?.imageModel]);

  // An unset knob falls through to the agent's own configuration, so that is
  // what the controls show as their baseline - not the provider default the
  // builder may already have moved away from.
  const agentParams = useMemo(
    () => parseModelParamValues(agent?.modelParams ?? ""),
    [agent?.modelParams],
  );
  const agentImageParams = useMemo(
    () => parseModelParamValues(agent?.imageParams ?? ""),
    [agent?.imageParams],
  );

  const pickModel = (modelId: string) => {
    if (modelId === modelOverride) return;
    update.mutate({
      modelOverride: modelId,
      modelParams: paramsForModelSwitch(
        models,
        modelId,
        agent?.primaryModel ?? "",
        config?.modelParams ?? {},
      ),
    });
  };

  const overrideInList = !modelOverride || models.some((m) => m.id === modelOverride);
  const loading = configQuery.isLoading || modelsQuery.isLoading;
  const disabled = update.isPending || !config;

  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <View style={styles.header}>
        <Faders size={18} color={T.accent} weight="duotone" />
        <Text style={[styles.title, { color: T.textBright }]}>Model for this chat</Text>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={T.accent} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>MODEL</Text>
          <ModelRow
            T={T}
            title="Agent default"
            subtitle={agent?.primaryModel || undefined}
            selected={!modelOverride}
            onPress={() => pickModel("")}
          />
          {overrideInList ? null : (
            <ModelRow
              T={T}
              title={modelOverride}
              subtitle="Unavailable"
              selected
              onPress={() => {}}
            />
          )}
          {models.map((m: AgentModelOption) => (
            <ModelRow
              key={m.id}
              T={T}
              title={m.displayName || m.id}
              subtitle={m.provider}
              selected={modelOverride === m.id}
              onPress={() => pickModel(m.id)}
            />
          ))}
          {models.length === 0 ? (
            <Text style={[styles.empty, { color: T.textDim }]}>No models available</Text>
          ) : null}

          {schemaJson ? (
            <ModelParamsSection
              T={T}
              schemaJson={schemaJson}
              values={config?.modelParams ?? {}}
              inheritedValues={agentParams}
              disabled={disabled}
              onChange={(next) => update.mutate({ modelParams: next })}
            />
          ) : effectiveModelId ? (
            <Text style={[styles.notice, { color: T.textDim }]}>
              No tunable parameters for this model.
            </Text>
          ) : (
            <Text style={[styles.notice, { color: T.textDim }]}>
              This agent follows the organization default model. Pick a model for this chat to tune
              its parameters.
            </Text>
          )}

          {imageSchemaJson ? (
            <ModelParamsSection
              T={T}
              title="IMAGE GENERATION"
              schemaJson={imageSchemaJson}
              values={config?.imageParams ?? {}}
              inheritedValues={agentImageParams}
              disabled={disabled}
              onChange={(next) => update.mutate({ imageParams: next })}
            />
          ) : null}

          <View style={styles.bottomPad} />
        </ScrollView>
      )}
    </BottomSheet>
  );
}

function ModelRow({
  T,
  title,
  subtitle,
  selected,
  onPress,
}: {
  T: ThemeColors;
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.modelRow, { borderTopColor: T.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.modelName, { color: T.textBright }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.modelMeta, { color: T.textDim }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Check size={16} color={T.accent} weight="bold" /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // The knob form is tall enough that the sheet needs a fixed height, or it
  // grows past the screen as sections appear.
  sheet: { height: "80%", maxHeight: "80%" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  title: { fontSize: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  loading: { paddingVertical: 32, alignItems: "center" },
  scroll: { paddingHorizontal: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  notice: { fontSize: 12, fontFamily: FONT.regular, paddingTop: 18, lineHeight: 17 },
  empty: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center", paddingVertical: 16 },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  modelName: { fontSize: 14, fontFamily: FONT.medium },
  modelMeta: { fontSize: 11, fontFamily: FONT.regular, marginTop: 1 },
  bottomPad: { height: 24 },
});
