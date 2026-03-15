import React from "react";
import { TouchableOpacity, Text, StyleSheet } from "react-native";
import { NotePencil, FolderSimple, ChatCircle, CalendarBlank, Kanban } from "phosphor-react-native";
import type { Domain } from "@/lib/types";
import { DOMAIN_COLORS } from "@/constants/theme";

const DOMAIN_ICONS: Record<Domain, React.ComponentType<any>> = {
  notes: NotePencil,
  files: FolderSimple,
  chat: ChatCircle,
  calendar: CalendarBlank,
  projects: Kanban,
};

export const DOMAIN_ICON: Record<Domain, React.ComponentType<any>> = DOMAIN_ICONS;

type ReferenceChipProps = {
  domain: Domain;
  label: string;
  onPress?: () => void;
};

export function getDomainColor(domain: Domain): string {
  switch (domain) {
    case "notes":
      return DOMAIN_COLORS.notes;
    case "files":
      return DOMAIN_COLORS.files;
    case "chat":
      return DOMAIN_COLORS.chat;
    case "calendar":
      return DOMAIN_COLORS.calendar;
    case "projects":
      return DOMAIN_COLORS.projects;
  }
}

export function getDomainSoftColor(domain: Domain): string {
  switch (domain) {
    case "notes":
      return DOMAIN_COLORS.notesSoft;
    case "files":
      return DOMAIN_COLORS.filesSoft;
    case "chat":
      return DOMAIN_COLORS.chatSoft;
    case "calendar":
      return DOMAIN_COLORS.calendarSoft;
    case "projects":
      return DOMAIN_COLORS.projectsSoft;
  }
}

export function ReferenceChip({ domain, label, onPress }: ReferenceChipProps) {
  const color = getDomainColor(domain);
  const softColor = getDomainSoftColor(domain);
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
    fontFamily: "Inter_500Medium",
  },
});
