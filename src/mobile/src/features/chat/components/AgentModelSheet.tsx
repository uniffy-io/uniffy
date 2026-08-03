import React from "react";
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
import { useAgentModels, type AgentModelOption } from "@features/agents/useAgents";
import {
  useChannelAgentConfig,
  useUpdateChannelAgentConfig,
} from "@features/chat/useChannelAgentConfig";

export function AgentModelSheet({
  visible,
  T,
  channelId,
  agentId,
  agentPrimaryModel,
  agentProviderKeyId,
  onClose,
}: {
  visible: boolean;
  T: ThemeColors;
  channelId: string;
  agentId: string;
  agentPrimaryModel: string;
  agentProviderKeyId: string;
  onClose: () => void;
}) {
  // Loaded as soon as the agent DM opens, not on sheet open: the sheet is
  // mounted for the whole chat, so waiting for `visible` shows an empty list first.
  const configQuery = useChannelAgentConfig(channelId, agentId);
  const update = useUpdateChannelAgentConfig(channelId, agentId);
  const modelsQuery = useAgentModels(agentProviderKeyId, true);

  const models = modelsQuery.data ?? [];
  const modelOverride = configQuery.data?.modelOverride ?? "";

  const pickModel = (modelId: string) => {
    if (modelId === modelOverride) return;
    update.mutate({ modelOverride: modelId });
  };

  const overrideInList = !modelOverride || models.some((m) => m.id === modelOverride);
  const loading = configQuery.isLoading || modelsQuery.isLoading;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
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
            subtitle={agentPrimaryModel || undefined}
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
  bottomPad: { height: 12 },
});
