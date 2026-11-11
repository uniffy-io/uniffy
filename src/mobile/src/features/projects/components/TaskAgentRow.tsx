import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Robot } from "phosphor-react-native";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { useTheme } from "@shared/hooks/useTheme";
import { formatDateTimeShort } from "@shared/lib/dateFormatting";
import { FONT } from "@theme/typography";
import { toolActionLabel } from "@features/agents/toolLabels";
import { useAgentSession } from "@features/agents/useAgentSession";
import { AgentChangesSheet } from "@features/projects/components/AgentChangesSheet";
import {
  agentRunStatusLabel,
  canRequestAgentChanges,
  isAgentRunActive,
  isAgentRunOpen,
  isAgentRunScheduled,
  type SerializedTaskAgent,
} from "@features/projects/projectsSerializer";

interface AgentAction {
  key: string;
  label: string;
  a11y: string;
  onPress: () => void;
}

function subtitle(agent: SerializedTaskAgent, forName: string): string {
  if (agent.status === "waiting") return `Waiting for Start, for ${forName}`;
  if (isAgentRunScheduled(agent) && agent.startAt) {
    return `Starts ${formatDateTimeShort(agent.startAt)}, for ${forName}`;
  }
  if (!isAgentRunActive(agent)) return `Assigned by ${forName}`;
  return agent.reason === "project"
    ? `Picked up from the project for ${forName}`
    : `Working for ${forName}`;
}

/** The agent on a task: its state, its session for the person it works for, and run controls. */
export function TaskAgentRow({
  agent,
  isMine,
  forName,
  canEdit,
  busy,
  onStart,
  onStop,
  onRunAgain,
  onRemove,
  onSendChanges,
}: {
  agent: SerializedTaskAgent;
  isMine: boolean;
  forName: string;
  canEdit: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRunAgain: () => void;
  onRemove: () => void;
  /** Resolves true once the server took the changes, so the sheet can close. */
  onSendChanges: (changes: string) => Promise<boolean>;
}) {
  const T = useTheme();
  const [open, setOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const active = isAgentRunActive(agent);
  const runOpen = isAgentRunOpen(agent);
  const held = agent.status === "waiting" || isAgentRunScheduled(agent);
  const session = useAgentSession(agent.sessionId, active, open && isMine);
  const name = agent.agentName;

  const actions: AgentAction[] = [];
  if (canEdit && held && !agent.agentIsDeleted) {
    const label = agent.status === "waiting" ? "Start" : "Start now";
    actions.push({ key: "start", label, a11y: `${label} ${name}`, onPress: onStart });
  }
  if (canEdit && runOpen && agent.status !== "waiting") {
    actions.push({ key: "stop", label: "Stop", a11y: `Stop ${name}`, onPress: onStop });
  }
  if (canEdit && isMine && canRequestAgentChanges(agent)) {
    actions.push({
      key: "changes",
      label: "Request changes",
      a11y: `Request changes from ${name}`,
      onPress: () => setChangesOpen(true),
    });
  }
  if (canEdit && !runOpen && !agent.agentIsDeleted) {
    actions.push({
      key: "again",
      label: "Run again",
      a11y: `Run ${name} again`,
      onPress: onRunAgain,
    });
  }
  if (canEdit && !active) {
    actions.push({ key: "remove", label: "Remove", a11y: `Remove ${name}`, onPress: onRemove });
  }

  return (
    <View style={[styles.row, { borderBottomColor: T.border }]} testID="task-agent-row">
      <View style={styles.head}>
        <Avatar name={name} emoji={agent.agentAvatarEmoji} isAgent size={28} />
        <View style={styles.body}>
          <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
            {name} · {agentRunStatusLabel(agent)}
          </Text>
          <Text style={[styles.sub, { color: T.textDim }]} numberOfLines={1}>
            {subtitle(agent, isMine ? "you" : forName)}
          </Text>
        </View>
        {isMine && agent.sessionId ? (
          <TouchableOpacity
            onPress={() => setOpen(true)}
            style={styles.action}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}'s session`}
          >
            <Text style={[styles.actionText, { color: T.accent }]}>Session</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {actions.length > 0 ? (
        <View style={styles.actions}>
          {actions.map((action) => (
            <TouchableOpacity
              key={action.key}
              onPress={action.onPress}
              disabled={busy}
              style={styles.action}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={action.a11y}
              testID={`task-agent-${action.key}`}
            >
              <Text style={[styles.actionText, { color: busy ? T.textDim : T.accent }]}>
                {action.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <AgentChangesSheet
        visible={changesOpen}
        agentName={name}
        pending={busy}
        onClose={() => setChangesOpen(false)}
        onSend={(changes) => {
          void onSendChanges(changes).then((sent) => {
            if (sent) setChangesOpen(false);
          });
        }}
      />
      <BottomSheet visible={open} onClose={() => setOpen(false)} fill>
        <SheetHeader title={agent.agentName} busy={session.isFetching && active} />
        <Text style={[styles.note, { color: T.textDim }]}>
          It works with your permissions; only you can see this session.
        </Text>
        <ScrollView contentContainerStyle={styles.transcript}>
          {(session.data ?? []).map((line) =>
            line.kind === "tool" ? (
              <View key={line.id} style={styles.toolLine}>
                <Robot size={13} color={T.textDim} />
                <Text style={[styles.toolText, { color: T.textDim }]}>
                  {toolActionLabel(line.text)}
                </Text>
              </View>
            ) : line.kind === "brief" ? (
              <Text key={line.id} style={[styles.brief, { color: T.textDim }]}>
                {line.text}
              </Text>
            ) : (
              <View key={line.id} style={[styles.reply, { backgroundColor: T.surface }]}>
                <MarkdownRenderer content={line.text} />
              </View>
            ),
          )}
          {active ? <Text style={[styles.brief, { color: T.textDim }]}>Working...</Text> : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, paddingLeft: 38 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontFamily: FONT.medium },
  sub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  actionText: { fontSize: 14, fontFamily: FONT.medium },
  note: { fontSize: 12, fontFamily: FONT.regular, paddingHorizontal: 16, paddingBottom: 8 },
  transcript: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  toolLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  toolText: { fontSize: 12, fontFamily: FONT.regular },
  brief: { fontSize: 12, fontFamily: FONT.regular },
  reply: { borderRadius: 10, padding: 10 },
});
