import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { ArrowLeft } from "phosphor-react-native";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import type { Domain } from "@/lib/types";
import { DOMAIN_ICON } from "@/components/ReferenceChip";

type DomainHeaderProps = {
  title: string;
  color: string;
  icon: Domain | string;
  onBack?: () => void;
  rightActions?: React.ReactNode;
  subtitle?: string;
};

export function DomainHeader({
  title,
  color,
  icon,
  onBack,
  rightActions,
  subtitle,
}: DomainHeaderProps) {
  const T = useTheme();

  const domainKeys: Domain[] = ["notes", "files", "chat", "calendar", "projects"];
  const isDomain = domainKeys.includes(icon as Domain);
  const IconComponent = isDomain ? DOMAIN_ICON[icon as Domain] : null;

  return (
    <View style={[styles.container, { backgroundColor: T.surface, borderBottomColor: T.border }]}>
      <View style={styles.row}>
        <TouchableOpacity
          onPress={onBack ?? (() => router.back())}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={20} color={T.text} weight="bold" />
        </TouchableOpacity>

        <View style={styles.titleRow}>
          {IconComponent && (
            <View style={[styles.iconWrap, { backgroundColor: color + "20" }]}>
              <IconComponent size={16} color={color} weight="bold" />
            </View>
          )}
          <View>
            <Text style={[styles.title, { color: T.textBright }]}>{title}</Text>
            {subtitle && <Text style={[styles.subtitle, { color: T.textDim }]}>{subtitle}</Text>}
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
    paddingTop: 12,
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
  title: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  subtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
});
