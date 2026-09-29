import React, { useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { ArrowsClockwise, CalendarBlank, Clock, MapPin, Users } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { zonedDayKey } from "@shared/lib/zonedTime";
import { eventDisplayState } from "@features/calendar/eventDisplay";
import { formatCalendarDate, type SerializedEvent } from "@features/calendar/calendarSerializer";

interface DateGroup {
  key: string;
  label: string;
  events: SerializedEvent[];
}

function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const n = new Date(y, m - 1, d + 1);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

export function AgendaList({
  events,
  colorOf,
  liveChannelIds,
  bottomPad,
  onEventPress,
  refreshing,
  onRefresh,
}: {
  events: SerializedEvent[];
  colorOf: (event: SerializedEvent) => string;
  liveChannelIds: ReadonlySet<string>;
  bottomPad: number;
  onEventPress: (id: string) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const T = useTheme();

  const groups = useMemo<DateGroup[]>(() => {
    const now = new Date();
    const todayKey = zonedDayKey(now.toISOString());
    const tomorrowKey = zonedDayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());

    const byDay = new Map<string, SerializedEvent[]>();
    for (const event of events) {
      if (!event.startTime) continue;
      // A multi-day event lists on every covered day, not only where it
      // starts. The walk is bounded in case of a degenerate range.
      const endKey = event.endTime ? zonedDayKey(event.endTime) : zonedDayKey(event.startTime);
      let key = zonedDayKey(event.startTime);
      for (let guard = 0; key <= endKey && guard < 62; guard++) {
        const bucket = byDay.get(key) ?? [];
        bucket.push(event);
        byDay.set(key, bucket);
        key = nextDayKey(key);
      }
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, dayEvents]) => ({
        key,
        label:
          key === todayKey
            ? `Today · ${formatCalendarDate(key)}`
            : key === tomorrowKey
              ? `Tomorrow · ${formatCalendarDate(key)}`
              : formatCalendarDate(key),
        events: dayEvents.sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        ),
      }));
  }, [events]);

  if (groups.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <CalendarBlank size={44} color={T.textDim} weight="duotone" />
        <Text style={[styles.emptyText, { color: T.textDim }]}>No upcoming events</Text>
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={T.accent}
          colors={[T.accent]}
        />
      }
    >
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={[styles.groupLabel, { color: T.textDim }]}>{group.label}</Text>
          {group.events.map((event) => {
            const display = eventDisplayState(event);
            const color = colorOf(event);
            const live =
              !!event.channelId &&
              liveChannelIds.has(event.channelId) &&
              !display.cancelled &&
              !display.detailsHidden;
            return (
              <TouchableOpacity
                key={event.id}
                style={[
                  styles.row,
                  { backgroundColor: T.surface, borderColor: T.border },
                  (display.cancelled || display.tentative) && styles.faded,
                ]}
                onPress={() => onEventPress(event.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.colorBar, { backgroundColor: color }]} />
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[
                        styles.title,
                        { color: T.textBright },
                        display.cancelled && styles.struck,
                      ]}
                      numberOfLines={1}
                    >
                      {display.title}
                    </Text>
                    {live ? (
                      <View style={[styles.livePill, { backgroundColor: T.red + "1E" }]}>
                        <View style={[styles.liveDot, { backgroundColor: T.red }]} />
                        <Text style={[styles.liveText, { color: T.red }]}>Live</Text>
                      </View>
                    ) : null}
                    {display.outOfOffice ? (
                      <Text style={[styles.oooBadge, { color: T.textDim }]}>OOO</Text>
                    ) : null}
                  </View>
                  <View style={styles.metaRow}>
                    <View style={styles.meta}>
                      <Clock size={11} color={T.textDim} weight="duotone" />
                      <Text style={[styles.metaText, { color: T.textDim }]}>
                        {event.isAllDay
                          ? "All day"
                          : `${event.startTimeFormatted} – ${event.endTimeFormatted}`}
                      </Text>
                    </View>
                    {event.location ? (
                      <View style={styles.meta}>
                        <MapPin size={11} color={T.textDim} weight="duotone" />
                        <Text style={[styles.metaText, { color: T.textDim }]} numberOfLines={1}>
                          {event.location}
                        </Text>
                      </View>
                    ) : null}
                    {event.attendees.length > 1 ? (
                      <View style={styles.meta}>
                        <Users size={11} color={T.textDim} weight="duotone" />
                        <Text style={[styles.metaText, { color: T.textDim }]}>
                          {event.attendees.length}
                        </Text>
                      </View>
                    ) : null}
                    {event.isRecurring ? (
                      <ArrowsClockwise size={11} color={T.textDim} weight="bold" />
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 14, gap: 18 },
  group: { gap: 8 },
  groupLabel: { fontSize: 12, fontFamily: FONT.semibold, letterSpacing: 0.4 },
  row: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  faded: { opacity: 0.65 },
  colorBar: { width: 3, borderRadius: 2, alignSelf: "stretch" },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontFamily: FONT.semibold, flexShrink: 1 },
  struck: { textDecorationLine: "line-through" },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 10, fontFamily: FONT.bold },
  oooBadge: { fontSize: 10, fontFamily: FONT.semibold },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  metaText: { fontSize: 12, fontFamily: FONT.regular },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  emptyText: { fontSize: 14, fontFamily: FONT.regular },
});
