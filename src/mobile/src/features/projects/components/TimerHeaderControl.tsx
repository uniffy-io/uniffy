import React from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Pause, Play, Stop } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { formatClock } from "@features/projects/timeSerializer";
import { useActiveTimer, useTimerElapsed } from "@features/projects/useActiveTimer";
import {
  usePauseTimer,
  useResumeTimer,
  useStartTimer,
  useStopTimer,
} from "@features/projects/useTimeMutations";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

/** Start, pause, resume and stop the person's timer from the task header. */
export function TimerHeaderControl({ taskId, projectId }: { taskId: string; projectId: string }) {
  const T = useTheme();
  const timerQuery = useActiveTimer();
  const timer = timerQuery.data ?? null;
  const onThisTask = timer?.taskId === taskId;
  const elapsed = useTimerElapsed(onThisTask ? timer : null);
  const start = useStartTimer();
  const pause = usePauseTimer();
  const resume = useResumeTimer();
  const stop = useStopTimer();
  const busy = start.isPending || pause.isPending || resume.isPending || stop.isPending;

  if (!timer || !onThisTask) {
    const startHere = () => start.mutate({ taskId, projectId });
    const onPress = () => {
      if (!timer) {
        startHere();
        return;
      }
      const label = `${timer.projectSlug.toUpperCase()}-${timer.taskNumber}`;
      confirmDestructive({
        title: "Switch timer",
        message: `Stop the timer on ${label}, log its time on today, and start one here?`,
        confirmLabel: "Switch",
        onConfirm: startHere,
      });
    };
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={busy}
        hitSlop={HIT_SLOP}
        accessibilityLabel="Start timer"
        testID="timer-start"
      >
        <Play size={20} color={T.text} weight="regular" />
      </TouchableOpacity>
    );
  }

  const running = Boolean(timer.startedAt);
  return (
    <View style={styles.row} testID="timer-controls">
      <Text style={[styles.clock, { color: running ? T.accent : T.textDim }]}>
        {formatClock(elapsed)}
      </Text>
      <TouchableOpacity
        onPress={() => (running ? pause.mutate() : resume.mutate())}
        disabled={busy}
        hitSlop={HIT_SLOP}
        accessibilityLabel={running ? "Pause timer" : "Resume timer"}
        testID="timer-toggle"
      >
        {running ? (
          <Pause size={20} color={T.accent} weight="fill" />
        ) : (
          <Play size={20} color={T.accent} weight="fill" />
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => stop.mutate({ taskId, projectId })}
        disabled={busy}
        hitSlop={HIT_SLOP}
        accessibilityLabel="Stop timer and log the time"
        testID="timer-stop"
      >
        <Stop size={20} color={T.red} weight="fill" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  clock: { fontFamily: FONT.medium, fontSize: 13, fontVariant: ["tabular-nums"] },
});
