import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { useTheme } from "@shared/hooks/useTheme";
import { instantFromZonedWall, zonedDayKey, zonedParts } from "@shared/lib/zonedTime";
import { FONT } from "@theme/typography";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { TimePicker } from "@features/calendar/components/TimePicker";
import type { AgentRunStart } from "@features/projects/projectsSerializer";

type Choice = AgentRunStart["kind"];

const HOUR_MS = 60 * 60 * 1000;

function nextFullHour(): { day: string; time: string } {
  const next = new Date(Math.ceil((Date.now() + 1) / HOUR_MS) * HOUR_MS);
  const parts = zonedParts(next);
  return { day: zonedDayKey(next), time: `${String(parts.hour).padStart(2, "0")}:00` };
}

/** Asks when a newly picked agent starts on the task: now, on Start, or at a set time. */
export function AgentStartSheet({
  visible,
  agentName,
  pending,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  agentName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (start: AgentRunStart) => void;
}) {
  const T = useTheme();
  const [choice, setChoice] = useState<Choice>("now");
  const [when, setWhen] = useState(nextFullHour);
  // Render-phase reset, so reopening never shows the previous pick.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setChoice("now");
      setWhen(nextFullHour());
    }
  }

  const at = when.day ? instantFromZonedWall(when.day, when.time) : null;
  const ready = choice !== "at" || at !== null;

  const confirm = () => {
    if (!ready || pending) return;
    if (choice !== "at" || !at) {
      onConfirm({ kind: choice === "wait" ? "wait" : "now" });
      return;
    }
    if (at.getTime() <= Date.now()) {
      Alert.alert("Pick a time in the future", "The agent can only be scheduled ahead.");
      return;
    }
    onConfirm({ kind: "at", at });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} style={styles.sheet}>
      <SheetHeader title={`When should ${agentName} start?`} />
      <SheetRow
        title="Start now"
        subtitle="It starts working on the task right away"
        selected={choice === "now"}
        onPress={() => setChoice("now")}
      />
      <SheetRow
        title="Start later"
        subtitle="Press Start on the task when it is ready"
        selected={choice === "wait"}
        onPress={() => setChoice("wait")}
      />
      <SheetRow
        title="Start at a set time"
        subtitle="It starts on its own at the time you pick"
        selected={choice === "at"}
        onPress={() => setChoice("at")}
      />
      {choice === "at" ? (
        <View style={styles.when}>
          <CalendarPicker
            value={when.day}
            onChange={(day) => setWhen((prev) => ({ ...prev, day: day ?? prev.day }))}
            placeholder="Pick a day"
          />
          <TimePicker
            value={when.time}
            onChange={(time) => setWhen((prev) => ({ ...prev, time }))}
          />
        </View>
      ) : null}
      <TouchableOpacity
        style={[styles.cta, { backgroundColor: ready ? T.accent : T.surfaceHover }]}
        disabled={!ready || pending}
        onPress={confirm}
        activeOpacity={0.8}
        accessibilityRole="button"
        testID="agent-start-confirm"
      >
        <Text style={[styles.ctaText, { color: ready ? "#fff" : T.textDim }]}>
          {pending ? "Saving..." : choice === "now" ? "Assign and start" : "Assign"}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16 },
  when: { gap: 10, paddingVertical: 12 },
  cta: { marginTop: 14, paddingVertical: 13, borderRadius: 12, alignItems: "center" },
  ctaText: { fontSize: 15, fontFamily: FONT.semibold },
});
