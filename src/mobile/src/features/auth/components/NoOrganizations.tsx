import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Buildings } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

/** `askAdmin` is for an account with no other way in: it cannot create and holds no invitation. */
export function NoOrganizations({ askAdmin }: { askAdmin: boolean }) {
  const T = useTheme();

  return (
    <View style={styles.root}>
      <Buildings size={48} color={T.textDim} weight="duotone" />
      <Text style={[styles.text, { color: T.textDim }]}>
        You are not in an organization yet.{askAdmin ? "\nAsk an admin to invite you." : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  text: {
    fontSize: 15,
    fontFamily: FONT.regular,
    textAlign: "center",
    lineHeight: 22,
  },
});
