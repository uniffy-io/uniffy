import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import {
  CheckCircle,
  XCircle,
  Warning,
  FileText,
  ArrowClockwise,
  Lightning,
  CaretDown,
  CaretUp,
} from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { SerializedMessage } from "@features/chat/chatSerializer";
import { parseImageMeta } from "@features/agents/imageMeta";
import { internalToolName, toolActionLabel, useToolLabels } from "@features/agents/toolLabels";
import { GeneratedImageCard } from "@features/agents/components/GeneratedImageCard";
import { DetailsCaret, MonoBlock, MONO_FONT } from "@features/agents/components/AgentDetailsBlock";
import { ToolActivityPane, type ToolStep } from "@features/agents/components/ToolActivityPane";

const ERROR_RESULT_RE = /^(Error|Permission denied|Not found|Validation error)/i;

const IMAGE_TOOL_HINT = "Image generation can take up to 5 minutes - hang tight.";

function meta(message: SerializedMessage, key: string): string | undefined {
  const value = message.metadata?.[key];
  return value && value.length > 0 ? value : undefined;
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
  toolRun,
  toolResultFor,
  resolveUserName,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  agentActive: boolean;
  /** A folded run of consecutive tool calls, oldest first; absent for a lone call. */
  toolRun?: SerializedMessage[];
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
  resolveUserName?: (userId: string) => string | undefined;
}) {
  // Every label below resolves through the catalog cache, which fills after a
  // cached transcript has already rendered.
  useToolLabels();

  const kind = message.metadata?.kind ?? "final";
  switch (kind) {
    case "tool_call":
      return (
        <AgentToolActivityPane
          toolMessages={toolRun && toolRun.length > 0 ? toolRun : [message]}
          T={T}
          agentActive={agentActive}
          toolResultFor={toolResultFor}
        />
      );
    case "tool_result":
      // A result whose call row is present is absorbed into the run pane (the
      // list drops it); this only renders an orphan.
      return <ToolResultRow message={message} T={T} />;
    case "summary":
      return <SummaryRow message={message} T={T} />;
    case "context_reset":
      return <ContextResetRow message={message} T={T} resolveUserName={resolveUserName} />;
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

/**
 * Binds a run of tool-call rows to the activity pane: each call pairs with its
 * result row for status, timing and payload, and a generated image hangs its
 * card off the run.
 */
function AgentToolActivityPane({
  toolMessages,
  T,
  agentActive,
  toolResultFor,
}: {
  toolMessages: SerializedMessage[];
  T: ThemeColors;
  agentActive: boolean;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
}) {
  const steps = useMemo<ToolStep[]>(
    () =>
      toolMessages.map((message) => {
        const toolName = meta(message, "tool_name") ?? "tool";
        const toolCallId = meta(message, "tool_call_id");
        const resultMsg = toolCallId ? toolResultFor(toolCallId) : undefined;
        const result = resultMsg?.content || (resultMsg && meta(resultMsg, "tool_result")) || "";
        const failed = !!resultMsg && ERROR_RESULT_RE.test(result);
        const running = !resultMsg && agentActive;
        const interrupted = !resultMsg && !agentActive;
        const isImage = internalToolName(toolName).includes("image");
        return {
          id: message.id,
          toolName,
          label: toolActionLabel(toolName),
          args: meta(message, "tool_args"),
          result: result || undefined,
          status: running
            ? "running"
            : interrupted
              ? "interrupted"
              : failed
                ? "failed"
                : "completed",
          durationSecs: resultMsg
            ? Math.max(0, resultMsg.createdAtSeconds - message.createdAtSeconds)
            : undefined,
          hint: running && isImage ? IMAGE_TOOL_HINT : undefined,
        };
      }),
    [toolMessages, agentActive, toolResultFor],
  );

  // A generated image carries its resolved params on the result row; they are
  // what the regenerate menu patches, and the model never saw most of them.
  // Parsing that metadata is JSON work on the render path of a screen that
  // re-renders on every stream event.
  const imageResults = useMemo(
    () =>
      toolMessages.flatMap((message) => {
        const toolCallId = meta(message, "tool_call_id");
        const resultMsg = toolCallId ? toolResultFor(toolCallId) : undefined;
        const imageMeta = resultMsg ? parseImageMeta(resultMsg.metadata?.tool_meta) : null;
        return imageMeta && resultMsg ? [{ messageId: resultMsg.id, meta: imageMeta }] : [];
      }),
    [toolMessages, toolResultFor],
  );

  const live = steps.some((step) => step.status === "running");

  return (
    <View style={styles.toolPane}>
      <ToolActivityPane T={T} steps={steps} live={live} answerStarted={!live} />
      {imageResults.map(({ messageId, meta: imageMeta }) => (
        <GeneratedImageCard
          key={messageId}
          T={T}
          meta={imageMeta}
          channelId={toolMessages[0].channelId}
          messageId={messageId}
        />
      ))}
    </View>
  );
}

/** An orphan tool result whose call row never arrived; a single settled step. */
function ToolResultRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const toolName = meta(message, "tool_name") ?? "tool";
  const result = message.content || meta(message, "tool_result") || "";
  const steps: ToolStep[] = [
    {
      id: message.id,
      toolName,
      label: toolActionLabel(toolName),
      result: result || undefined,
      status: ERROR_RESULT_RE.test(result) ? "failed" : "completed",
    },
  ];

  return (
    <View style={styles.toolPane}>
      <ToolActivityPane T={T} steps={steps} live={false} answerStarted />
    </View>
  );
}

/** The rolled-up message ids arrive as a JSON array in the string-valued map. */
function compactedCount(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed || !trimmed.startsWith("[") || !trimmed.endsWith("]")) return 0;
  return trimmed
    .slice(1, -1)
    .split(",")
    .filter((entry) => entry.trim().length > 0).length;
}

function SummaryRow({ message, T }: { message: SerializedMessage; T: ThemeColors }) {
  const [expanded, setExpanded] = useState(false);
  const rolledUp = compactedCount(message.metadata?.compacted_msg_ids);
  return (
    <View>
      <TouchableOpacity
        style={styles.summaryHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <FileText size={14} color={T.textDim} weight="duotone" />
        <Text style={[styles.summaryLabel, { color: T.textDim }]}>
          Conversation summary
          {rolledUp > 0 ? ` (${rolledUp} messages rolled up)` : ""}
        </Text>
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

function ContextResetRow({
  message,
  T,
  resolveUserName,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  resolveUserName?: (userId: string) => string | undefined;
}) {
  const resetByUserId = meta(message, "reset_by_user_id") ?? "";
  const name =
    meta(message, "reset_by_name") ??
    (resetByUserId ? resolveUserName?.(resetByUserId) : undefined) ??
    "someone";
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
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => setShowRaw(!showRaw)}
        disabled={!hasMore}
        activeOpacity={0.6}
      >
        <Warning size={16} color={T.red} weight="fill" />
        <View style={styles.cardHeaderText}>
          <Text style={[styles.errorLabel, { color: T.red }]}>AGENT ERROR</Text>
          <Text style={[styles.cardTitle, { color: T.text }]}>{display}</Text>
        </View>
        {hasMore ? <DetailsCaret T={T} open={showRaw} /> : null}
      </TouchableOpacity>
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
        {approved ? "Approved" : "Denied"}: {toolActionLabel(toolName)}
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
        <View style={styles.cardHeaderText}>
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
    alignSelf: "stretch",
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardHeaderText: { flex: 1 },
  toolPane: { alignSelf: "stretch", marginBottom: 4, gap: 6 },
  cardTitle: { fontSize: 13, fontFamily: FONT.medium, lineHeight: 18 },
  cardMono: { fontSize: 11, fontFamily: MONO_FONT, marginTop: 1 },
  errorLabel: { fontSize: 10, fontFamily: FONT.bold, letterSpacing: 0.6, marginBottom: 1 },
  summaryHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  summaryLabel: { fontSize: 11, fontFamily: FONT.medium, letterSpacing: 0.4, flexShrink: 1 },
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
