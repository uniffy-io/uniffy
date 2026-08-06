import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ArrowUp } from "phosphor-react-native";
import { FONT } from "@theme/typography";
import { getOptionById } from "@features/projects/projectsSerializer";
import type { PlainSelectOption } from "@features/projects/projectsSerializer";

export function TaskPriorityBadge({
  priority,
  options,
}: {
  priority: string;
  options: PlainSelectOption[];
}) {
  const option = getOptionById(options, priority);
  if (!option) return null;

  const label = option.label.toLowerCase();
  const urgent = label.includes("high") || label.includes("urgent");

  return (
    <View style={[styles.badge, { backgroundColor: option.color + "18" }]}>
      {urgent ? <ArrowUp size={9} color={option.color} weight="bold" /> : null}
      <Text style={[styles.text, { color: option.color }]}>{option.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  text: { fontSize: 10, fontFamily: FONT.medium },
});
