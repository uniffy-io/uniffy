import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { Avatar } from "@shared/components/Avatar";
import type { CallHistoryPerson } from "@features/calls/historySerializer";
import {
  activityRuns,
  activityTime,
  activityCoverage,
  activityDescription,
} from "@features/calls/activityPresentation";

export function CallActivity({ people }: { people: CallHistoryPerson[] }) {
  const T = useTheme();
  const [selected, setSelected] = useState<{ userId: string; index: number } | null>(null);
  const [width, setWidth] = useState(1);
  const attendees = people.filter((person) => person.presentSeconds > 0);
  const duration = Math.max(1, ...people.map((person) => person.activityDurationSeconds));
  const captured = attendees.some((person) => person.observedSeconds > 0);
  const person = attendees.find((item) => item.userId === selected?.userId);
  const bucket = person?.activity[Math.min(selected?.index ?? 0, person.activity.length - 1)];
  return (
    <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: T.textBright }]}>Speaking activity</Text>
        <Text style={[styles.caption, { color: T.textDim }]}>Estimated</Text>
      </View>
      <Text style={[styles.caption, { color: T.textDim, marginTop: 6 }]}>
        {captured
          ? "Who spoke, and when. Tap a point to inspect."
          : "Speaking activity wasn't captured for this call."}
      </Text>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: T.accent }]} />
          <Text style={[styles.caption, { color: T.textDim }]}>Speaking</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: T.border }]}>
            <View style={[styles.quiet, { backgroundColor: T.textDim }]} />
          </View>
          <Text style={[styles.caption, { color: T.textDim }]}>Quiet</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: T.border }]}>
            <View style={[styles.unknown, styles.swatchUnknown, { borderColor: T.textDim }]} />
          </View>
          <Text style={[styles.caption, { color: T.textDim }]}>Unavailable</Text>
        </View>
      </View>
      <View style={styles.axis}>
        <Text style={[styles.small, { color: T.textDim }]}>0:00</Text>
        <Text style={[styles.small, { color: T.textDim }]}>{activityTime(duration / 2)}</Text>
        <Text style={[styles.small, { color: T.textDim }]}>{activityTime(duration)}</Text>
      </View>
      {attendees.map((item) => {
        const index =
          selected?.userId === item.userId ? Math.min(selected.index, item.activity.length - 1) : 0;
        return (
          <View key={item.userId} style={styles.row}>
            <View style={styles.heading}>
              <Avatar name={item.name} size={24} />
              <Text numberOfLines={1} style={[styles.name, { color: T.text }]}>
                {item.name}
              </Text>
              <Text style={[styles.caption, { color: T.textBright }]}>
                {item.observedSeconds ? activityTime(item.speakingSeconds) : "No data"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="adjustable"
              accessibilityLabel={`${item.name} speaking timeline`}
              accessibilityValue={{
                min: 0,
                max: item.activity.length - 1,
                now: index,
                text: activityDescription(
                  item.activity[index],
                  item.activityResolutionSeconds,
                  duration,
                ),
              }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(event) =>
                setSelected({
                  userId: item.userId,
                  index: Math.max(
                    0,
                    Math.min(
                      item.activity.length - 1,
                      index + (event.nativeEvent.actionName === "increment" ? 1 : -1),
                    ),
                  ),
                })
              }
              onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
              onPress={(event) =>
                setSelected({
                  userId: item.userId,
                  index: Math.max(
                    0,
                    Math.min(
                      item.activity.length - 1,
                      Math.floor(
                        ((event.nativeEvent.locationX / width) * duration) /
                          item.activityResolutionSeconds,
                      ),
                    ),
                  ),
                })
              }
              style={styles.timeline}
            >
              {activityRuns(item.activity, item.activityResolutionSeconds, duration).map((part) => (
                <View
                  key={part.offsetSeconds}
                  pointerEvents="none"
                  style={[
                    styles.bin,
                    {
                      flex: part.durationSeconds,
                    },
                    { backgroundColor: part.presentSeconds ? T.border : "transparent" },
                  ]}
                >
                  {part.observedSeconds < part.presentSeconds && (
                    <View style={[styles.unknown, { borderColor: T.textDim }]} />
                  )}
                  {part.observedSeconds > 0 && (
                    <View style={[styles.quiet, { backgroundColor: T.textDim }]} />
                  )}
                  {part.speakingSeconds > 0 && (
                    <View
                      style={{
                        width: "100%",
                        height: `${Math.max(25, (part.speakingSeconds / item.activityResolutionSeconds) * 100)}%`,
                        backgroundColor: T.accent,
                      }}
                    />
                  )}
                </View>
              ))}
              {selected?.userId === item.userId && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.marker,
                    {
                      backgroundColor: T.text,
                      left: `${((item.activity[index].offsetSeconds + Math.min(item.activityResolutionSeconds, duration - item.activity[index].offsetSeconds) / 2) / duration) * 100}%`,
                    },
                  ]}
                />
              )}
            </Pressable>
          </View>
        );
      })}
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.caption, { color: T.textDim, minHeight: 40 }]}
      >
        {person && bucket
          ? `${person.name}: ${activityDescription(bucket, person.activityResolutionSeconds, duration)}`
          : "Gaps show missing activity data, not silence. No audio is recorded."}
      </Text>
      {captured && (
        <View style={[styles.talk, { borderColor: T.border }]}>
          <Text style={[styles.title, { color: T.textBright }]}>Talk time</Text>
          {attendees.map((item) => (
            <View key={item.userId} style={{ marginTop: 14 }}>
              <View style={styles.heading}>
                <Text style={[styles.name, { color: T.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.caption, { color: T.text }]}>
                  {item.observedSeconds ? activityTime(item.speakingSeconds) : "No data"}
                </Text>
              </View>
              <View style={[styles.bar, { backgroundColor: T.border }]}>
                <View
                  style={{
                    height: 5,
                    borderRadius: 3,
                    width: `${Math.min(100, (item.speakingSeconds / duration) * 100)}%`,
                    backgroundColor: T.accent,
                  }}
                />
              </View>
              <Text style={[styles.small, { color: T.textDim }]}>
                {activityCoverage(item.observedSeconds, item.presentSeconds)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginTop: 20 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: FONT.medium, fontSize: 14, flex: 1 },
  name: { fontFamily: FONT.medium, fontSize: 12, flex: 1 },
  caption: { fontFamily: FONT.regular, fontSize: 11 },
  small: { fontFamily: FONT.regular, fontSize: 10 },
  legend: { flexDirection: "row", gap: 16, marginVertical: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  // A miniature timeline bin, so each key reads exactly as it draws below.
  swatch: {
    width: 14,
    height: 10,
    borderRadius: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchUnknown: { height: 6 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  row: { marginBottom: 8 },
  timeline: { height: 44, flexDirection: "row", alignItems: "center" },
  bin: { flex: 1, height: 20, alignItems: "center", justifyContent: "center" },
  quiet: { position: "absolute", height: 3, width: "100%", opacity: 0.5 },
  unknown: {
    position: "absolute",
    height: 16,
    width: "100%",
    borderTopWidth: 1,
    borderStyle: "dotted",
    opacity: 0.5,
  },
  marker: { position: "absolute", width: 1, top: 3, bottom: 3 },
  talk: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 6 },
  bar: { height: 5, borderRadius: 3, marginTop: 6, marginBottom: 4, overflow: "hidden" },
});
