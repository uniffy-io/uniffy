import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** A group heading: caps label, its count, and a rule running to the edge. */
export function SectionRule({ label, count }: { label: string; count: number }) {
  const T = useTheme();
  return (
    <View style={styles.rule}>
      <Text style={[styles.label, { color: T.textDim }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.count, { color: T.textDim }]}>{count}</Text>
      <View style={[styles.line, { backgroundColor: T.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  rule: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 2,
  },
  count: {
    fontSize: 11,
    fontFamily: FONT.regular,
    opacity: 0.6,
  },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
