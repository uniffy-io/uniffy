import React, { useMemo, useRef, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CheckCircle, Stop, XCircle } from "phosphor-react-native";
import type { ThemeColors } from "@theme/theme";
import { FONT } from "@theme/typography";
import { DetailsCaret, DETAILS_GAP } from "@features/agents/components/AgentDetailsBlock";
import { ToolPayloadCard } from "@features/agents/components/ToolPayloadCard";
import { readableToolPayload, type ReadablePayload } from "@features/agents/toolPayload";

export type ToolStepStatus = "running" | "completed" | "failed" | "interrupted";

export interface ToolStep {
  id: string;
  toolName: string;
  /** Catalog display name, e.g. "Create Note" (see toolActionLabel). */
  label: string;
  args?: string;
  result?: string;
  status: ToolStepStatus;
  durationSecs?: number;
  /** Extra line under a running step, e.g. a slow-operation notice. */
  hint?: string;
}

function formatStepDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/**
 * Collapsible timeline for one run of tool calls, wearing the quoted-reply
 * chip's shape: a pill that names what the agent is doing and unfolds into the
 * steps, each of which opens onto its input and result.
 *
 * Expanded while the run is live and collapsed once the answer starts, unless
 * the reader says otherwise.
 */
export function ToolActivityPane({
  T,
  steps,
  live,
  answerStarted,
  onDetailsToggled,
}: {
  T: ThemeColors;
  steps: readonly ToolStep[];
  live: boolean;
  answerStarted: boolean;
  onDetailsToggled?: (heightDelta: number) => void;
}) {
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const bodyHeightRef = useRef(0);
  // Only a tap moves the viewport: auto-expanding a live run happens while the
  // reader sits at the bottom of the inverted list, where growth is already
  // anchored and a compensating scroll would fight it.
  const reportNextLayoutRef = useRef(false);

  if (steps.length === 0) return null;

  const expanded = userToggle ?? !answerStarted;
  const active = steps.find((step) => step.status === "running");
  const headerLabel = live
    ? active
      ? `${active.label}...`
      : "Working..."
    : steps.length === 1
      ? steps[0].label
      : `Ran ${steps.length} actions`;
  // The dim half of the pill, mirroring the quoted-reply preview: what the run
  // cost, once there is a settled number to give.
  const totalSecs = steps.reduce((sum, step) => sum + (step.durationSecs ?? 0), 0);
  const headerNote = !live && totalSecs > 0 ? `Took ${formatStepDuration(totalSecs)}` : "";

  const toggle = () => {
    if (expanded) {
      const height = bodyHeightRef.current;
      bodyHeightRef.current = 0;
      if (height > 0) onDetailsToggled?.(-(height + DETAILS_GAP));
    } else {
      reportNextLayoutRef.current = true;
    }
    setUserToggle(!expanded);
  };

  return (
    <View style={[styles.pane, expanded && styles.paneOpen, { backgroundColor: T.surfaceHover }]}>
      <TouchableOpacity style={styles.header} onPress={toggle} activeOpacity={0.7}>
        {live ? (
          <ActivityIndicator size={13} color={T.textDim} />
        ) : (
          <StatusIcon T={T} status={steps[steps.length - 1].status} />
        )}
        <Text style={[styles.headerTitle, { color: T.textBright }]} numberOfLines={1}>
          {headerLabel}
        </Text>
        {headerNote ? (
          <Text style={[styles.headerNote, { color: T.textDim }]} numberOfLines={1}>
            {headerNote}
          </Text>
        ) : null}
        <DetailsCaret T={T} open={expanded} />
      </TouchableOpacity>
      {expanded ? (
        <View
          style={styles.body}
          onLayout={(e) => {
            const height = e.nativeEvent.layout.height;
            if (reportNextLayoutRef.current && height > 0) {
              reportNextLayoutRef.current = false;
              onDetailsToggled?.(height + DETAILS_GAP);
            }
            bodyHeightRef.current = height;
          }}
        >
          {/* A lone action is fully described by the pill header, so opening it
              goes straight to the payloads instead of through a one-row
              timeline that would only repeat the title and the timing. */}
          {steps.length === 1 ? (
            <LoneStep T={T} step={steps[0]} />
          ) : (
            steps.map((step, idx) => (
              <StepRow
                key={step.id}
                T={T}
                step={step}
                last={idx === steps.length - 1}
                onDetailsToggled={onDetailsToggled}
              />
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function StatusIcon({ T, status }: { T: ThemeColors; status: ToolStepStatus }) {
  switch (status) {
    case "running":
      return <ActivityIndicator size={13} color={T.textDim} />;
    case "failed":
      return <XCircle size={14} color={T.red} weight="fill" />;
    case "interrupted":
      return <Stop size={14} color={T.textDim} weight="fill" />;
    default:
      // Muted like the reasoning pane's settled icons; only failure gets color.
      return <CheckCircle size={14} color={T.textDim} weight="fill" />;
  }
}

/**
 * Reading a payload means parsing it, and a tool result can be hundreds of
 * kilobytes. The step's fields are strings, so this survives the re-render every
 * arriving message triggers on a live run.
 */
function useStepPayloads(step: ToolStep): { args: ReadablePayload; result: ReadablePayload } {
  const args = useMemo(() => readableToolPayload(step.args), [step.args]);
  const result = useMemo(() => readableToolPayload(step.result), [step.result]);
  return { args, result };
}

/** The readable halves of one step: what it was asked for, what came back. */
function StepPayloads({
  T,
  args,
  result,
}: {
  T: ThemeColors;
  args: ReadablePayload;
  result: ReadablePayload;
}) {
  return (
    <View style={styles.payloads}>
      <ToolPayloadCard T={T} title="Input" payload={args} />
      <ToolPayloadCard T={T} title="Result" payload={result} />
    </View>
  );
}

/**
 * The lone step of a single-action run, which the pill header already names, so
 * it opens straight onto its payloads.
 */
function LoneStep({ T, step }: { T: ThemeColors; step: ToolStep }) {
  const { args, result } = useStepPayloads(step);
  return (
    <>
      <StepHint T={T} step={step} />
      <StepPayloads T={T} args={args} result={result} />
    </>
  );
}

function StepHint({ T, step }: { T: ThemeColors; step: ToolStep }) {
  if (step.status !== "running" || !step.hint) return null;
  return <Text style={[styles.stepHint, { color: T.textDim }]}>{step.hint}</Text>;
}

function StepRow({
  T,
  step,
  last,
  onDetailsToggled,
}: {
  T: ThemeColors;
  step: ToolStep;
  last: boolean;
  onDetailsToggled?: (heightDelta: number) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsHeightRef = useRef(0);

  const { args, result } = useStepPayloads(step);
  const hasDetails = args.kind !== "empty" || result.kind !== "empty";
  const hasDuration = step.durationSecs !== undefined && step.durationSecs > 0;

  const labelText =
    step.status === "running"
      ? `${step.label}...`
      : step.status === "interrupted"
        ? `${step.label} interrupted`
        : step.status === "failed"
          ? `${step.label} failed`
          : step.label;

  return (
    <View style={styles.stepRow}>
      <View style={styles.stepRail}>
        <StatusIcon T={T} status={step.status} />
        {last ? null : <View style={[styles.railLine, { backgroundColor: T.border }]} />}
      </View>
      <View style={styles.stepBody}>
        <TouchableOpacity
          style={styles.stepHeader}
          onPress={() => {
            if (showDetails) {
              const height = detailsHeightRef.current;
              detailsHeightRef.current = 0;
              if (height > 0) onDetailsToggled?.(-(height + DETAILS_GAP));
            }
            setShowDetails(!showDetails);
          }}
          disabled={!hasDetails}
          activeOpacity={0.6}
        >
          <Text style={[styles.stepLabel, { color: T.text }]} numberOfLines={2}>
            {labelText}
          </Text>
          {hasDuration ? (
            <Text style={[styles.stepDuration, { color: T.textDim }]}>
              {formatStepDuration(step.durationSecs!)}
            </Text>
          ) : null}
          {hasDetails ? <DetailsCaret T={T} open={showDetails} /> : null}
        </TouchableOpacity>
        <StepHint T={T} step={step} />
        {showDetails ? (
          <View
            onLayout={(e) => {
              const height = e.nativeEvent.layout.height;
              if (detailsHeightRef.current === 0 && height > 0) {
                onDetailsToggled?.(height + DETAILS_GAP);
              }
              detailsHeightRef.current = height;
            }}
          >
            <StepPayloads T={T} args={args} result={result} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same chip as a quoted reply: a compact pill that squares off and opens up
  // once it holds more than its own title.
  pane: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    borderRadius: 13,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 4,
  },
  paneOpen: {
    alignSelf: "stretch",
    borderRadius: 12,
    paddingRight: 12,
    paddingTop: 6,
    paddingBottom: 8,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 7 },
  headerTitle: { fontSize: 12, lineHeight: 16, fontFamily: FONT.semibold, flexShrink: 1 },
  headerNote: { fontSize: 12, lineHeight: 16, fontFamily: FONT.regular, flexShrink: 1 },
  body: { marginTop: 7 },
  stepRow: { flexDirection: "row", gap: 8 },
  stepRail: { width: 16, alignItems: "center", paddingTop: 2 },
  railLine: { width: StyleSheet.hairlineWidth, flex: 1, marginTop: 4 },
  stepBody: { flex: 1, paddingBottom: 8, gap: 4 },
  stepHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepLabel: { flex: 1, fontSize: 12, fontFamily: FONT.medium, lineHeight: 17 },
  stepDuration: { fontSize: 11, fontFamily: FONT.regular },
  stepHint: { fontSize: 11, fontFamily: FONT.regular, lineHeight: 15 },
  payloads: { gap: 6, marginTop: 2 },
});
