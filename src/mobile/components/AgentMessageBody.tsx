import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import {
  Wrench,
  CheckCircle,
  XCircle,
  Warning,
  FileText,
  ArrowClockwise,
  Lightning,
  CaretDown,
  CaretUp,
} from "phosphor-react-native";
import type { ThemeColors } from "@/constants/theme";
import { FONT } from "@/constants/typography";
import type { SerializedMessage } from "@/lib/chatSerializer";

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const ERROR_RESULT_RE = /^(Error|Permission denied|Not found|Validation error)/i;

function meta(message: SerializedMessage, key: string): string | undefined {
  const value = message.metadata?.[key];
  return value && value.length > 0 ? value : undefined;
}

function humanizeToolName(toolName: string): string {
  const [, action] = toolName.split(".", 2);
  const verb = (action ?? toolName).replace(/_/g, " ");
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

/** Agent message kinds that render a special body instead of markdown. */
export function isSpecialAgentKind(message: SerializedMessage): boolean {
  const kind = message.metadata?.kind;
  return !!kind && kind !== "final";
}

export function AgentMessageBody({
  message,
  T,
  agentActive,
  toolResultFor,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  agentActive: boolean;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
}) {
  const kind = message.metadata?.kind ?? "final";
  switch (kind) {
    case "tool_call":
      return (
        <ToolCallRow
          message={message}
          T={T}
          agentActive={agentActive}
          toolResultFor={toolResultFor}
        />
      );
    case "tool_result":
      return <ToolResultRow message={message} T={T} />;
    case "summary":
      return <SummaryRow message={message} T={T} />;
    case "context_reset":
      return <ContextResetRow message={message} T={T} />;
    case "agent_error":
      return <AgentErrorRow message={message} T={T} />;
    case "confirmation_resolved":
      return <ConfirmationResolvedRow message={message} T={T} />;
    case "confirmation_request":
      // Live approval cards render above the composer from the pending
      // approvals query; the persisted message row stays silent.
      return null;
    case "skill_draft":
      return <SkillDraftRow message={message} T={T} />;
    default:
      return null;
  }
}

function DetailsToggle({
  T,
  open,
  onPress,
}: {
  T: ThemeColors;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.detailsToggle}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Text style={[styles.detailsToggleText, { color: T.textDim }]}>
        {open ? "Hide details" : "Show details"}
      </Text>
      {open ? (
        <CaretUp size={10} color={T.textDim} weight="bold" />
      ) : (
        <CaretDown size={10} color={T.textDim} weight="bold" />
      )}
    </TouchableOpacity>
  );
}

function MonoBlock({ T, text }: { T: ThemeColors; text: string }) {
  return (
    <View style={[styles.monoBlock, { backgroundColor: T.bg, borderColor: T.border }]}>
      <Text style={[styles.monoText, { color: T.text }]}>{text}</Text>
    </View>
  );
}

function ToolCallRow({
  message,
  T,
  agentActive,
  toolResultFor,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  agentActive: boolean;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const toolName = meta(message, "tool_name") ?? "tool";
  const toolArgs = meta(message, "tool_args");
  const toolCallId = meta(message, "tool_call_id");
  const resultMsg = toolCallId ? toolResultFor(toolCallId) : undefined;

  const result = resultMsg?.content || (resultMsg && meta(resultMsg, "tool_result")) || "";
  const failed = !!resultMsg && ERROR_RESULT_RE.test(result);
  const running = !resultMsg && agentActive;
  const interrupted = !resultMsg && !agentActive;

  const hasArgs = !!toolArgs && toolArgs !== "{}" && toolArgs !== "None";
  const hasResult = result.trim().length > 0;

  const label = running
    ? `Running ${humanizeToolName(toolName).toLowerCase()}...`
    : interrupted
      ? `${humanizeToolName(toolName)} interrupted`
      : `${humanizeToolName(toolName)} ${failed ? "failed" : "completed"}`;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: failed ? T.red + "14" : T.surface, borderColor: T.border },
      ]}
    >
      <View style={styles.cardHeader}>
        {running ? (
          <ActivityIndicator size={14} color={T.domains.chat} />
        ) : failed ? (
          <XCircle size={16} color={T.red} weight="fill" />
        ) : resultMsg ? (
          <CheckCircle size={16} color={T.green} weight="fill" />
        ) : (
          <Wrench size={16} color={T.textDim} weight="duotone" />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: T.text }]}>{label}</Text>
          <Text style={[styles.cardMono, { color: T.textDim }]} numberOfLines={1}>
            {toolName}
          </Text>
        </View>
      </View>
      {hasArgs || hasResult ? (
        <DetailsToggle T={T} open={showDetails} onPress={() => setShowDetails((v) => !v)} />
      ) : null}
      {showDetails && hasArgs ? <MonoBlock T={T} text={toolArgs!} /> : null}
      {showDetails && hasResult ? <MonoBlock T={T} text={result} /> : null}
    </View>
  );
}

function ToolResultRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const [showDetails, setShowDetails] = useState(false);
  const toolName = meta(message, "tool_name") ?? "tool";
  const result = message.content || meta(message, "tool_result") || "";
  const failed = ERROR_RESULT_RE.test(result);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: failed ? T.red + "14" : T.surface, borderColor: T.border },
      ]}
    >
      <View style={styles.cardHeader}>
        {failed ? (
          <XCircle size={16} color={T.red} weight="fill" />
        ) : (
          <CheckCircle size={16} color={T.green} weight="fill" />
        )}
        <Text style={[styles.cardMono, { color: T.textDim, flex: 1 }]} numberOfLines={1}>
          {toolName} {failed ? "failed" : "completed"}
        </Text>
      </View>
      {result.trim().length > 0 ? (
        <DetailsToggle T={T} open={showDetails} onPress={() => setShowDetails((v) => !v)} />
      ) : null}
      {showDetails ? <MonoBlock T={T} text={result} /> : null}
    </View>
  );
}

function SummaryRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View>
      <TouchableOpacity
        style={styles.summaryHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <FileText size={14} color={T.textDim} weight="duotone" />
        <Text style={[styles.summaryLabel, { color: T.textDim }]}>Conversation summary</Text>
        {expanded ? (
          <CaretUp size={10} color={T.textDim} weight="bold" />
        ) : (
          <CaretDown size={10} color={T.textDim} weight="bold" />
        )}
      </TouchableOpacity>
      {expanded && message.content ? (
        <Text style={[styles.summaryBody, { color: T.textDim }]}>{message.content}</Text>
      ) : null}
    </View>
  );
}

function ContextResetRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const name = meta(message, "reset_by_name") ?? "someone";
  return (
    <View style={styles.resetRow}>
      <View style={[styles.resetLine, { backgroundColor: T.border }]} />
      <View style={[styles.resetPill, { backgroundColor: T.surface, borderColor: T.border }]}>
        <ArrowClockwise size={11} color={T.textDim} weight="bold" />
        <Text style={[styles.resetText, { color: T.textDim }]}>
          Conversation reset by {name} - {message.timeLabel}
        </Text>
      </View>
      <View style={[styles.resetLine, { backgroundColor: T.border }]} />
    </View>
  );
}

function AgentErrorRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const [showRaw, setShowRaw] = useState(false);
  const display = message.content || "Unknown error";
  const raw = meta(message, "raw_error");
  const hasMore = !!raw && raw !== display;

  return (
    <View style={[styles.card, { backgroundColor: T.red + "14", borderColor: T.red + "50" }]}>
      <View style={styles.cardHeader}>
        <Warning size={16} color={T.red} weight="fill" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.errorLabel, { color: T.red }]}>AGENT ERROR</Text>
          <Text style={[styles.cardTitle, { color: T.text }]}>{display}</Text>
        </View>
      </View>
      {hasMore ? (
        <DetailsToggle T={T} open={showRaw} onPress={() => setShowRaw((v) => !v)} />
      ) : null}
      {showRaw && raw ? <MonoBlock T={T} text={raw} /> : null}
    </View>
  );
}

function ConfirmationResolvedRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const decision = meta(message, "decision") ?? "approved";
  const toolName = meta(message, "tool_name") ?? "tool";
  const approved = decision === "approved";
  return (
    <View style={styles.resolvedRow}>
      {approved ? (
        <CheckCircle size={14} color={T.green} weight="fill" />
      ) : (
        <XCircle size={14} color={T.red} weight="fill" />
      )}
      <Text style={[styles.resolvedText, { color: T.textDim }]}>
        {approved ? "Approved" : "Denied"}: {humanizeToolName(toolName)}
      </Text>
    </View>
  );
}

function SkillDraftRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const title =
    meta(message, "draft_display_name") ?? meta(message, "draft_name") ?? "Proposed skill";
  const status = meta(message, "draft_status") ?? "pending";
  return (
    <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.accent + "50" }]}>
      <View style={styles.cardHeader}>
        <Lightning size={16} color={T.accent} weight="fill" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: T.text }]}>Proposed skill: {title}</Text>
          <Text style={[styles.cardMono, { color: T.textDim }]}>
            {status === "pending"
              ? "Review and save from the web app"
              : status === "saved"
                ? "Saved to skills"
                : "Discarded"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 13, fontFamily: FONT.medium, lineHeight: 18 },
  cardMono: { fontSize: 11, fontFamily: MONO_FONT, marginTop: 1 },
  detailsToggle: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  detailsToggleText: { fontSize: 11, fontFamily: FONT.medium },
  monoBlock: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    maxHeight: 200,
    overflow: "hidden",
  },
  monoText: { fontSize: 11, fontFamily: MONO_FONT, lineHeight: 16 },
  errorLabel: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.6, marginBottom: 1 },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLabel: { fontSize: 11, fontFamily: FONT.medium, letterSpacing: 0.4 },
  summaryBody: {
    fontSize: 12,
    fontFamily: FONT.regular,
    fontStyle: "italic",
    marginTop: 4,
    lineHeight: 17,
  },
  resetRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  resetLine: { flex: 1, height: StyleSheet.hairlineWidth },
  resetPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  resetText: { fontSize: 11, fontFamily: FONT.regular },
  resolvedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  resolvedText: { fontSize: 12, fontFamily: FONT.regular },
});
