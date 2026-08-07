import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Buildings, LockSimple } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export type NoteSpace = "personal" | "organization";

const SPACES = [
  { key: "personal" as NoteSpace, label: "Personal", Icon: LockSimple },
  { key: "organization" as NoteSpace, label: "Organization", Icon: Buildings },
] as const;

/** Personal / Organization segment shared by the create and move sheets. */
export function SpacePicker({
  value,
  onSelect,
}: {
  value: NoteSpace;
  onSelect: (space: NoteSpace) => void;
}) {
  const T = useTheme();
  return (
    <View style={styles.row}>
      {SPACES.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <TouchableOpacity
            key={key}
            style={[
              styles.btn,
              {
                borderColor: active ? T.accent : T.border,
                backgroundColor: active ? T.accentSoft : T.surface,
              },
            ]}
            onPress={() => onSelect(key)}
            activeOpacity={0.7}
          >
            <Icon size={18} color={active ? T.accent : T.textDim} weight="duotone" />
            <Text style={[styles.label, { color: active ? T.accent : T.textDim }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, paddingHorizontal: 20, paddingBottom: 14 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  label: { fontSize: 14, fontFamily: FONT.medium },
});
