import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import {
  NotePencil,
  FolderSimple,
  ChatCircle,
  CalendarBlank,
  Kanban,
  Robot,
  User,
  UsersThree,
} from "phosphor-react-native";
import type { Domain } from "@core/types";
import { FONT } from "@theme/typography";
import { useTheme } from "@shared/hooks/useTheme";

const DOMAIN_ICONS: Record<Domain, React.ComponentType<any>> = {
  notes: NotePencil,
  files: FolderSimple,
  chat: ChatCircle,
  calendar: CalendarBlank,
  projects: Kanban,
  agents: Robot,
};

export const DOMAIN_ICON: Record<Domain, React.ComponentType<any>> = DOMAIN_ICONS;

export type ReferenceChipKind = Domain | "user" | "group";

type ReferenceChipProps = {
  domain: ReferenceChipKind;
  label: string;
  onPress?: () => void;
};

export function ReferenceChip({ domain, label, onPress }: ReferenceChipProps) {
  const T = useTheme();
  const isSubject = domain === "user" || domain === "group";
  const color = domain === "user" ? T.green : T.accent;
  const softColor = isSubject ? color + "22" : T.accentSoft;
  const IconComponent = isSubject ? (domain === "user" ? User : UsersThree) : DOMAIN_ICONS[domain];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
      style={[styles.chip, { backgroundColor: softColor, borderColor: color + "40" }]}
    >
      <IconComponent size={10} color={color} weight="bold" />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  label: {
    fontSize: 11,
    fontFamily: FONT.medium,
  },
});
