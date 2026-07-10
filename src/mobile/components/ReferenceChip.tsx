import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import {
  NotePencil,
  FolderSimple,
  ChatCircle,
  CalendarBlank,
  Kanban,
  Robot,
} from "phosphor-react-native";
import type { Domain } from "@/lib/types";
import { FONT } from "@/constants/typography";
import { useTheme } from "@/hooks/useTheme";

const DOMAIN_ICONS: Record<Domain, React.ComponentType<any>> = {
  notes: NotePencil,
  files: FolderSimple,
  chat: ChatCircle,
  calendar: CalendarBlank,
  projects: Kanban,
  agents: Robot,
};

export const DOMAIN_ICON: Record<Domain, React.ComponentType<any>> = DOMAIN_ICONS;

type ReferenceChipProps = {
  domain: Domain;
  label: string;
  onPress?: () => void;
};

export function ReferenceChip({ domain, label, onPress }: ReferenceChipProps) {
  const T = useTheme();
  const color = T.domains[domain];
  const softColor = T.domains[`${domain}Soft`];
  const IconComponent = DOMAIN_ICONS[domain];

  return (
    <TouchableOpacity
      onPress={onPress}
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
