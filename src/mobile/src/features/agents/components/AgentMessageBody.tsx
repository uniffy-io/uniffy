import React, { useRef, useState } from "react";
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
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import type { SerializedMessage } from "@features/chat/chatSerializer";

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const ERROR_RESULT_RE = /^(Error|Permission denied|Not found|Validation error)/i;

function meta(message: SerializedMessage, key: string): string | undefined {
  const value = message.metadata?.[key];
  return value && value.length > 0 ? value : undefined;
}

// Tool names are "{domain}-{action}" (e.g. notes-read_note); drop the domain
// prefix so titles read as the action alone.
function humanizeToolName(toolName: string): string {
  const separator = toolName.search(/[.-]/);
  const action = separator >= 0 ? toolName.slice(separator + 1) : toolName;
  const verb = action.replace(/_/g, " ");
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
  onDetailsToggled,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  agentActive: boolean;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
  onDetailsToggled?: (heightDelta: number) => void;
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
          onDetailsToggled={onDetailsToggled}
        />
      );
    case "tool_result":
      return <ToolResultRow message={message} T={T} onDetailsToggled={onDetailsToggled} />;
    case "summary":
      return <SummaryRow message={message} T={T} />;
    case "context_reset":
      return <ContextResetRow message={message} T={T} />;
    case "agent_error":
      return <AgentErrorRow message={message} T={T} onDetailsToggled={onDetailsToggled} />;
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

function DetailsCaret({ T, open }: { T: ThemeColors; open: boolean }) {
  return (
    <View style={styles.caret}>
      {open ? (
        <CaretUp size={12} color={T.textDim} weight="bold" />
      ) : (
        <CaretDown size={12} color={T.textDim} weight="bold" />
      )}
    </View>
  );
}

// Expanded payloads render fully inline and scroll with the conversation: a
// nested ScrollView never receives scroll gestures inside the inverted chat
// list on Android. The cap keeps a giant payload from bloating the list.
const MONO_CHAR_LIMIT = 20000;

// Matches styles.card gap: the details stack adds this much on top of its own
// measured height when it mounts.
const CARD_GAP = 6;

function MonoBlock({ T, text }: { T: ThemeColors; text: string }) {
  const truncated = text.length > MONO_CHAR_LIMIT;
  return (
    <View style={[styles.monoBlock, { backgroundColor: T.bg, borderColor: T.border }]}>
      <Text style={[styles.monoText, { color: T.text }]}>
        {truncated ? text.slice(0, MONO_CHAR_LIMIT) : text}
      </Text>
      {truncated ? (
        <Text style={[styles.monoTruncatedNote, { color: T.textDim }]}>Output truncated</Text>
      ) : null}
    </View>
  );
}

function ToolCallRow({
  message,
  T,
  agentActive,
  toolResultFor,
  onDetailsToggled,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  agentActive: boolean;
  toolResultFor: (toolCallId: string) => SerializedMessage | undefined;
  onDetailsToggled?: (heightDelta: number) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsHeightRef = useRef(0);
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

  const hasDetails = hasArgs || hasResult;

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
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => {
          if (showDetails) {
            const height = detailsHeightRef.current;
            detailsHeightRef.current = 0;
            if (height > 0) onDetailsToggled?.(-(height + CARD_GAP));
          }
          setShowDetails(!showDetails);
        }}
        disabled={!hasDetails}
        activeOpacity={0.6}
      >
        {running ? (
          <ActivityIndicator size={14} color={T.domains.chat} />
        ) : failed ? (
          <XCircle size={16} color={T.red} weight="fill" />
        ) : resultMsg ? (
          <CheckCircle size={16} color={T.green} weight="fill" />
        ) : (
          <Wrench size={16} color={T.textDim} weight="duotone" />
        )}
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: T.text }]}>{label}</Text>
          <Text style={[styles.cardMono, { color: T.textDim }]} numberOfLines={1}>
            {toolName}
          </Text>
        </View>
        {hasDetails ? <DetailsCaret T={T} open={showDetails} /> : null}
      </TouchableOpacity>
      {showDetails ? (
        <View
          style={styles.detailsStack}
          onLayout={(e) => {
            const height = e.nativeEvent.layout.height;
            if (detailsHeightRef.current === 0 && height > 0) {
              onDetailsToggled?.(height + CARD_GAP);
            }
            detailsHeightRef.current = height;
          }}
        >
          {hasArgs ? <MonoBlock T={T} text={toolArgs!} /> : null}
          {hasResult ? <MonoBlock T={T} text={result} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function ToolResultRow({
  message,
  T,
  onDetailsToggled,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  onDetailsToggled?: (heightDelta: number) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsHeightRef = useRef(0);
  const toolName = meta(message, "tool_name") ?? "tool";
  const result = message.content || meta(message, "tool_result") || "";
  const failed = ERROR_RESULT_RE.test(result);

  const hasResult = result.trim().length > 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: failed ? T.red + "14" : T.surface, borderColor: T.border },
      ]}
    >
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => {
          if (showDetails) {
            const height = detailsHeightRef.current;
            detailsHeightRef.current = 0;
            if (height > 0) onDetailsToggled?.(-(height + CARD_GAP));
          }
          setShowDetails(!showDetails);
        }}
        disabled={!hasResult}
        activeOpacity={0.6}
      >
        {failed ? (
          <XCircle size={16} color={T.red} weight="fill" />
        ) : (
          <CheckCircle size={16} color={T.green} weight="fill" />
        )}
        <Text style={[styles.cardMono, { color: T.textDim, flex: 1 }]} numberOfLines={1}>
          {toolName} {failed ? "failed" : "completed"}
        </Text>
        {hasResult ? <DetailsCaret T={T} open={showDetails} /> : null}
      </TouchableOpacity>
      {showDetails ? (
        <View
          onLayout={(e) => {
            const height = e.nativeEvent.layout.height;
            if (detailsHeightRef.current === 0 && height > 0) {
              onDetailsToggled?.(height + CARD_GAP);
            }
            detailsHeightRef.current = height;
          }}
        >
          <MonoBlock T={T} text={result} />
        </View>
      ) : null}
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

function AgentErrorRow({
  message,
  T,
  onDetailsToggled,
}: {
  message: SerializedMessage;
  T: ThemeColors;
  onDetailsToggled?: (heightDelta: number) => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const detailsHeightRef = useRef(0);
  const display = message.content || "Unknown error";
  const raw = meta(message, "raw_error");
  const hasMore = !!raw && raw !== display;

  return (
    <View style={[styles.card, { backgroundColor: T.red + "14", borderColor: T.red + "50" }]}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => {
          if (showRaw) {
            const height = detailsHeightRef.current;
            detailsHeightRef.current = 0;
            if (height > 0) onDetailsToggled?.(-(height + CARD_GAP));
          }
          setShowRaw(!showRaw);
        }}
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
      {showRaw && raw ? (
        <View
          onLayout={(e) => {
            const height = e.nativeEvent.layout.height;
            if (detailsHeightRef.current === 0 && height > 0) {
              onDetailsToggled?.(height + CARD_GAP);
            }
            detailsHeightRef.current = height;
          }}
        >
          <MonoBlock T={T} text={raw} />
        </View>
      ) : null}
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
  detailsStack: { gap: 6 },
  cardTitle: { fontSize: 13, fontFamily: FONT.medium, lineHeight: 18 },
  cardMono: { fontSize: 11, fontFamily: MONO_FONT, marginTop: 1 },
  caret: { paddingTop: 2 },
  monoBlock: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
  },
  monoTruncatedNote: { fontSize: 10, fontFamily: FONT.medium, marginTop: 6 },
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
