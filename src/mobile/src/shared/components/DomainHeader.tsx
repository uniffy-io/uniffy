import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { ArrowLeft } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { Domain } from "@core/types";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";

type DomainHeaderProps = {
  title: string;
  color: string;
  icon: Domain | string;
  onBack?: () => void;
  showBack?: boolean;
  rightActions?: React.ReactNode;
  subtitle?: string;
};

export function DomainHeader({
  title,
  color,
  icon,
  onBack,
  showBack = true,
  rightActions,
  subtitle,
}: DomainHeaderProps) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 20 : insets.top) + 12;

  const IconComponent = icon in DOMAIN_ICON ? DOMAIN_ICON[icon as Domain] : null;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: T.surface, borderBottomColor: T.border, paddingTop: topPad },
      ]}
    >
      <View style={styles.row}>
        {showBack && (
          <TouchableOpacity
            onPress={onBack ?? (() => router.back())}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ArrowLeft size={20} color={T.text} weight="bold" />
          </TouchableOpacity>
        )}

        <View style={styles.titleRow}>
          {IconComponent && (
            <View style={[styles.iconWrap, { backgroundColor: color + "20" }]}>
              <IconComponent size={16} color={color} weight="bold" />
            </View>
          )}
          <View style={styles.titleTextWrap}>
            <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
              {title}
            </Text>
            {subtitle && (
              <Text style={[styles.subtitle, { color: T.textDim }]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.actions}>{rightActions}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    marginRight: 12,
    padding: 2,
  },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  titleTextWrap: {
    flexShrink: 1,
  },
  title: {
    fontSize: 17,
    fontFamily: FONT.semibold,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONT.regular,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
