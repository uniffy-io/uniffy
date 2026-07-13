import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { Warning, Check, X, CaretDown, CaretUp } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { SerializedPendingApproval } from "@features/chat/chatSerializer";

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

function humanizeToolName(toolName: string): string {
  const [, action] = toolName.split(".", 2);
  const verb = (action ?? toolName).replace(/_/g, " ");
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

function expiryLabel(expiresAtSeconds: number | null): string | null {
  if (!expiresAtSeconds) return null;
  const remainingMin = Math.floor((expiresAtSeconds * 1000 - Date.now()) / 60000);
  if (remainingMin <= 0) return "Expired";
  if (remainingMin < 60) return `Expires in ${remainingMin}m`;
  return `Expires in ${Math.round(remainingMin / 60)}h`;
}

export function AgentApprovalCard({
  approval,
  T,
  isActor,
  responding,
  onRespond,
}: {
  approval: SerializedPendingApproval;
  T: ThemeColors;
  isActor: boolean;
  responding: boolean;
  onRespond: (approve: boolean) => void;
}) {
  const [showArgs, setShowArgs] = useState(false);
  const hasArgs =
    !!approval.argsPreview && approval.argsPreview !== "{}" && approval.argsPreview !== "None";
  const expiry = expiryLabel(approval.expiresAtSeconds);

  return (
    <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.yellow + "80" }]}>
      <View style={styles.header}>
        <Warning size={18} color={T.yellow} weight="fill" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: T.textBright }]}>
            Approval required: {humanizeToolName(approval.toolName)}
          </Text>
          <Text style={[styles.toolName, { color: T.textDim }]} numberOfLines={1}>
            {approval.toolName}
            {expiry ? `  ·  ${expiry}` : ""}
          </Text>
        </View>
      </View>

      {hasArgs ? (
        <>
          <TouchableOpacity
            onPress={() => setShowArgs((v) => !v)}
            style={styles.argsToggle}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={[styles.argsToggleText, { color: T.textDim }]}>
              {showArgs ? "Hide arguments" : "Show arguments"}
            </Text>
            {showArgs ? (
              <CaretUp size={10} color={T.textDim} weight="bold" />
            ) : (
              <CaretDown size={10} color={T.textDim} weight="bold" />
            )}
          </TouchableOpacity>
          {showArgs ? (
            <View style={[styles.argsBlock, { backgroundColor: T.bg, borderColor: T.border }]}>
              <Text style={[styles.argsText, { color: T.text }]}>{approval.argsPreview}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {isActor ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: T.green, opacity: responding ? 0.6 : 1 }]}
            onPress={() => onRespond(true)}
            disabled={responding}
            activeOpacity={0.8}
          >
            <Check size={14} color="#fff" weight="bold" />
            <Text style={styles.actionText}>Allow</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              {
                backgroundColor: T.surfaceHover,
                borderColor: T.border,
                borderWidth: StyleSheet.hairlineWidth,
                opacity: responding ? 0.6 : 1,
              },
            ]}
            onPress={() => onRespond(false)}
            disabled={responding}
            activeOpacity={0.8}
          >
            <X size={14} color={T.text} weight="bold" />
            <Text style={[styles.actionText, { color: T.text }]}>Deny</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={[styles.waitingText, { color: T.textDim }]}>
          Waiting for the requester to approve...
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    padding: 12,
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { fontSize: 13, fontFamily: FONT.semibold, lineHeight: 18 },
  toolName: { fontSize: 11, fontFamily: MONO_FONT, marginTop: 1 },
  argsToggle: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  argsToggleText: { fontSize: 11, fontFamily: FONT.medium },
  argsBlock: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    maxHeight: 160,
    overflow: "hidden",
  },
  argsText: { fontSize: 11, fontFamily: MONO_FONT, lineHeight: 16 },
  actions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
  },
  actionText: { fontSize: 13, fontFamily: FONT.semibold, color: "#fff" },
  waitingText: { fontSize: 12, fontFamily: FONT.regular, fontStyle: "italic" },
});
