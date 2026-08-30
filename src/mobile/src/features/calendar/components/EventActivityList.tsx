import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { EventActivityAction } from "@uniffy/proto/cal/v1/calendar_pb";
import { Avatar } from "@shared/components/Avatar";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useDirectory } from "@shared/directory/useDirectory";
import { useEventActivities } from "@features/calendar/useCalendar";

const ACTION_LABELS: Record<number, string> = {
  [EventActivityAction.CREATED]: "created the event",
  [EventActivityAction.TITLE_CHANGED]: "renamed the event",
  [EventActivityAction.SCHEDULE_CHANGED]: "changed the schedule",
  [EventActivityAction.LOCATION_CHANGED]: "changed the location",
  [EventActivityAction.MEETING_CHANGED]: "changed the meeting",
  [EventActivityAction.DESCRIPTION_CHANGED]: "edited the description",
  [EventActivityAction.CATEGORY_CHANGED]: "changed the category",
  [EventActivityAction.CALENDAR_CHANGED]: "moved the event to another calendar",
  [EventActivityAction.RECURRENCE_CHANGED]: "changed the recurrence",
  [EventActivityAction.REMINDERS_CHANGED]: "changed the reminders",
  [EventActivityAction.ATTENDEES_ADDED]: "added attendees",
  [EventActivityAction.ATTENDEES_REMOVED]: "removed attendees",
  [EventActivityAction.RESPONSE_CHANGED]: "responded to the invitation",
  [EventActivityAction.FIELD_UPDATED]: "updated a field",
};

export function EventActivityList({ eventId, enabled }: { eventId: string; enabled: boolean }) {
  const T = useTheme();
  const activities = useEventActivities(eventId, enabled);
  const { byId } = useDirectory();

  if (!enabled) return null;

  if (activities.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={T.accent} />
      </View>
    );
  }

  if (!activities.data?.length) {
    return <Text style={[styles.empty, { color: T.textDim }]}>No activity yet</Text>;
  }

  return (
    <View>
      {activities.data.map((activity) => {
        const actor = byId.get(activity.actorId);
        return (
          <View key={activity.id} style={[styles.row, { borderBottomColor: T.border }]}>
            <Avatar name={actor?.name || "?"} avatarUrl={actor?.avatarUrl} size={26} />
            <View style={styles.body}>
              <Text style={[styles.line, { color: T.text }]} numberOfLines={2}>
                <Text style={[styles.actor, { color: T.textBright }]}>
                  {actor?.name || "Someone"}
                </Text>{" "}
                {ACTION_LABELS[activity.action] ?? "updated the event"}
              </Text>
              <Text style={[styles.time, { color: T.textDim }]}>{activity.timeLabel}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 16, alignItems: "center" },
  empty: { fontSize: 13, fontFamily: FONT.regular, paddingVertical: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 1 },
  line: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  actor: { fontFamily: FONT.semibold },
  time: { fontSize: 11, fontFamily: FONT.regular },
});
