import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { WarningCircle } from "phosphor-react-native";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { Domain } from "@core/types";

/**
 * What a detail screen shows when its content will not load - a deleted row, a
 * revoked share, a dropped connection. Keeps the header so there is always a
 * way back; rendering nothing strands the user on a blank screen.
 */
export function ScreenError({
  title,
  icon,
  color,
  message = "This content could not be loaded. It may have been deleted, or you may no longer have access.",
  onRetry,
}: {
  title: string;
  icon: Domain | string;
  color: string;
  message?: string;
  onRetry?: () => void;
}) {
  const T = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader title={title} color={color} icon={icon} />
      <View style={styles.body}>
        <WarningCircle size={40} color={T.textDim} weight="duotone" />
        <Text style={[styles.message, { color: T.textDim }]}>{message}</Text>
        {onRetry && (
          <TouchableOpacity
            style={[styles.retry, { backgroundColor: color }]}
            onPress={onRetry}
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  message: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", lineHeight: 20 },
  retry: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  retryText: { fontSize: 14, fontFamily: FONT.semibold, color: "#fff" },
});
