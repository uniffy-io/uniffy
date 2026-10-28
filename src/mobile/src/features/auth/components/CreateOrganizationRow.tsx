import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { CaretRight, Plus } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export function CreateOrganizationRow() {
  const T = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push("/create-organization" as any)}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <View style={[styles.icon, { backgroundColor: T.surfaceHover }]}>
          <Plus size={15} color={T.text} weight="regular" />
        </View>
        <View style={styles.info}>
          <Text style={[styles.label, { color: T.textBright }]}>Create organization</Text>
          <Text style={[styles.sub, { color: T.textDim }]}>You become its owner</Text>
        </View>
        <CaretRight size={15} color={T.textDim} weight="regular" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
  },
  label: {
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  sub: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 1,
  },
});
