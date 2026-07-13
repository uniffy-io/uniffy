import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Gauge, ArrowsInLineVertical, ArrowCounterClockwise } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  useChannelAgentContext,
  useCompactAgentContext,
  useResetAgentContext,
} from "@features/agents/useChannelAgentContext";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function AgentContextSheet({
  visible,
  T,
  channelId,
  agentId,
  agentName,
  onClose,
}: {
  visible: boolean;
  T: ThemeColors;
  channelId: string;
  agentId: string;
  agentName?: string;
  onClose: () => void;
}) {
  const statsQuery = useChannelAgentContext(channelId, agentId, visible);
  const compact = useCompactAgentContext(channelId, agentId);
  const reset = useResetAgentContext(channelId, agentId);
  const stats = statsQuery.data;

  const meterColor =
    stats && stats.usedPercent >= 90
      ? T.red
      : stats && stats.usedPercent >= 70
        ? T.yellow
        : T.green;

  const confirmReset = () => {
    Alert.alert(
      "Reset conversation context",
      "The agent forgets everything before this point. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset", style: "destructive", onPress: () => reset.mutate() },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: T.surface }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
        <View style={styles.header}>
          <Gauge size={18} color={T.domains.agents} weight="duotone" />
          <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
            {agentName ? `${agentName} context` : "Agent context"}
          </Text>
        </View>

        {statsQuery.isLoading || !stats ? (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={T.domains.agents} />
          </View>
        ) : (
          <>
            <View style={styles.meterBlock}>
              <View style={styles.meterLabels}>
                <Text style={[styles.meterPercent, { color: T.textBright }]}>
                  {stats.usedPercent}%
                </Text>
                <Text style={[styles.meterDetail, { color: T.textDim }]}>
                  {formatTokens(stats.activeTokens)} / {formatTokens(stats.tokenBudget)} tokens
                </Text>
              </View>
              <View style={[styles.meterTrack, { backgroundColor: T.bg }]}>
                <View
                  style={[
                    styles.meterFill,
                    { backgroundColor: meterColor, width: `${Math.max(stats.usedPercent, 2)}%` },
                  ]}
                />
              </View>
              <Text style={[styles.meterHint, { color: T.textDim }]}>
                {formatTokens(stats.contextWindowTokens)} token context window
                {stats.wasReset ? " · conversation was reset" : ""}
              </Text>
            </View>

            <StatRow
              T={T}
              label="Active messages"
              value={`${stats.activeMessages} of ${stats.totalMessages}`}
            />
            {stats.compactedMessages > 0 ? (
              <StatRow
                T={T}
                label="Rolled into summaries"
                value={`${stats.compactedMessages} messages · ${stats.summaryCount} ${stats.summaryCount === 1 ? "summary" : "summaries"}`}
              />
            ) : null}
            {stats.lastInputTokens > 0 || stats.lastOutputTokens > 0 ? (
              <StatRow
                T={T}
                label="Last turn"
                value={`${formatTokens(stats.lastInputTokens)} in · ${formatTokens(stats.lastOutputTokens)} out${stats.lastCacheReadTokens > 0 ? ` · ${formatTokens(stats.lastCacheReadTokens)} cached` : ""}`}
              />
            ) : null}

            <TouchableOpacity
              style={[styles.action, { backgroundColor: T.bg, borderColor: T.border }]}
              onPress={() => compact.mutate()}
              disabled={compact.isPending || stats.activeMessages === 0}
              activeOpacity={0.7}
            >
              <ArrowsInLineVertical size={17} color={T.domains.agents} weight="duotone" />
              <Text style={[styles.actionLabel, { color: T.textBright }]}>
                {compact.isPending ? "Compacting..." : "Compact conversation"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.action, { backgroundColor: T.bg, borderColor: T.border }]}
              onPress={confirmReset}
              disabled={reset.isPending}
              activeOpacity={0.7}
            >
              <ArrowCounterClockwise size={17} color={T.red} weight="duotone" />
              <Text style={[styles.actionLabel, { color: T.red }]}>
                {reset.isPending ? "Resetting..." : "Reset conversation"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Modal>
  );
}

function StatRow({ T, label, value }: { T: ThemeColors; label: string; value: string }) {
  return (
    <View style={[styles.statRow, { borderTopColor: T.border }]}>
      <Text style={[styles.statLabel, { color: T.textDim }]}>{label}</Text>
      <Text style={[styles.statValue, { color: T.textBright }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 10,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 12 },
  title: { fontSize: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  loading: { paddingVertical: 32, alignItems: "center" },
  meterBlock: { paddingBottom: 14 },
  meterLabels: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 },
  meterPercent: { fontSize: 22, fontFamily: FONT.bold },
  meterDetail: { fontSize: 12, fontFamily: FONT.regular },
  meterTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  meterFill: { height: "100%", borderRadius: 4 },
  meterHint: { fontSize: 11, fontFamily: FONT.regular, marginTop: 6 },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statLabel: { fontSize: 13, fontFamily: FONT.regular },
  statValue: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 10,
  },
  actionLabel: { fontSize: 14, fontFamily: FONT.medium },
});
