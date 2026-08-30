import React, { useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Door, Prohibit } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { SheetRow } from "@shared/components/SheetRow";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { useAvailableRoomIds, useRooms } from "@features/rooms/useRooms";
import type { SerializedRoom } from "@features/rooms/roomSerializer";

function roomSubtitle(room: SerializedRoom): string {
  const where = room.location || [room.building, room.floor].filter(Boolean).join(" ");
  const parts = [where].filter(Boolean);
  if (room.capacity > 0) {
    parts.push(`${room.capacity} ${room.capacity === 1 ? "person" : "people"}`);
  }
  if (room.amenities.length > 0) parts.push(room.amenities.join(", "));
  return parts.join(" · ");
}

export function RoomPickerSheet({
  visible,
  onClose,
  selectedRoomId,
  onSelect,
  startIso,
  endIso,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  selectedRoomId: string | null;
  onSelect: (roomId: string | null) => void;
  startIso?: string;
  endIso?: string;
  accentColor?: string;
}) {
  const T = useTheme();
  const accent = accentColor || T.accent;
  const [query, setQuery] = useState("");
  const rooms = useRooms();
  const available = useAvailableRoomIds(
    visible ? startIso : undefined,
    visible ? endIso : undefined,
  );

  const q = query.trim().toLowerCase();
  const filtered = (rooms.data ?? []).filter(
    (room) => !q || room.name.toLowerCase().includes(q) || room.location.toLowerCase().includes(q),
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader title="Room" accentColor={accent} />
      <SheetSearchBar value={query} onChangeText={setQuery} placeholder="Search rooms" />
      <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
        <SheetRow
          title="None"
          muted
          leading={<Prohibit size={18} color={T.textDim} weight="duotone" />}
          selected={!selectedRoomId}
          accentColor={accent}
          onPress={() => {
            onSelect(null);
            onClose();
          }}
        />
        {filtered.map((room) => {
          // A busy room stays selectable: the server is the judge of a real
          // clash, and the meeting being moved may be the one holding the slot.
          const busy = available.data ? !available.data.has(room.id) : false;
          return (
            <SheetRow
              key={room.id}
              title={room.name}
              subtitle={roomSubtitle(room) || undefined}
              leading={<Door size={18} color={busy ? T.textDim : accent} weight="duotone" />}
              trailing={
                busy ? <Text style={[styles.busy, { color: T.red }]}>Busy</Text> : undefined
              }
              selected={selectedRoomId === room.id}
              accentColor={accent}
              onPress={() => {
                onSelect(room.id);
                onClose();
              }}
            />
          );
        })}
        {rooms.isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={accent} />
          </View>
        )}
        {!rooms.isLoading && filtered.length === 0 && (
          <Text style={[styles.empty, { color: T.textDim }]}>No rooms to book</Text>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  busy: { fontSize: 11, fontFamily: FONT.semibold },
  loading: { padding: 16, alignItems: "center" },
  empty: {
    fontSize: 14,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 24,
  },
});
