import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { calendarHint } from "@features/calendar/calendarList";
import type { SerializedCalendar } from "@features/calendar/calendarSerializer";

/** Picks the calendar an event is filed on; callers pass only calendars the member can edit. */
export function CalendarTargetSheet({
  visible,
  onClose,
  calendars,
  selectedId,
  onSelect,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  calendars: SerializedCalendar[];
  selectedId: string;
  onSelect: (calendarId: string) => void;
  accentColor?: string;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Calendar" accentColor={accentColor} />
      <ScrollView style={{ maxHeight: 360 }}>
        {calendars.map((calendar) => (
          <SheetRow
            key={calendar.id}
            title={calendar.label}
            subtitle={calendarHint(calendar)}
            leading={<View style={[styles.dot, { backgroundColor: calendar.color }]} />}
            selected={calendar.id === selectedId}
            accentColor={calendar.color}
            onPress={() => {
              onSelect(calendar.id);
              onClose();
            }}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 6 },
});
