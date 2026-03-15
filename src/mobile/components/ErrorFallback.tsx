import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Warning } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { reloadAppAsync } from "expo";
import { DARK, LIGHT } from "@/constants/theme";

export type ErrorFallbackProps = { error?: Error; resetError?: () => void };

export function ErrorFallback({ error }: ErrorFallbackProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const T = colorScheme === "dark" ? DARK : LIGHT;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: T.pageBg, paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Warning size={48} color="#FA5252" weight="fill" />
      <Text style={[styles.title, { color: T.textBright }]}>Something went wrong</Text>
      {__DEV__ && error && (
        <Text style={[styles.message, { color: T.textDim }]}>{error.message}</Text>
      )}
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: T.accent }]}
        onPress={() => reloadAppAsync()}
      >
        <Text style={styles.btnText}>Reload App</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  btn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  btnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
