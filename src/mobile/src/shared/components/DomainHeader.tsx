import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { ArrowLeft } from "phosphor-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface } from "@shared/components/GlassSurface";
import { GlassIconButton } from "@shared/components/GlassIconButton";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { Domain } from "@core/types";
import { DOMAIN_ICON } from "@shared/mentions/ReferenceChip";

type DomainHeaderProps = {
  title: string;
  color: string;
  icon: Domain | string;
  leading?: React.ReactNode;
  onBack?: () => void;
  showBack?: boolean;
  rightActions?: React.ReactNode;
  subtitle?: string;
  /** Semi-transparent Android/web fill so scrolling content shows through the
   * pill and buttons. Use on surfaces that draw content behind the header. */
  translucent?: boolean;
};

const SEGMENT = 38;
const ACTION = 32;

// Segmented, translucent header shared by every screen: a glass back button, a
// glass title pill, and a glass action group over a transparent bar - so top
// bars read light and compact instead of one full-width solid strip. Glass is
// real liquid glass on iOS 26, system blur on older iOS, a solid themed fill on
// Android/web (see GlassSurface).
export function DomainHeader({
  title,
  color,
  icon,
  leading,
  onBack,
  showBack = true,
  rightActions,
  subtitle,
  translucent = false,
}: DomainHeaderProps) {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 20 : insets.top) + 6;
  const IconComponent = icon in DOMAIN_ICON ? DOMAIN_ICON[icon as Domain] : null;
  const glassBorder = T.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
  const glassTint = T.isDark ? "rgba(20,22,34,0.22)" : "rgba(255,255,255,0.35)";
  const glassSolid = translucent
    ? T.isDark
      ? "rgba(22,24,36,0.78)"
      : "rgba(248,249,252,0.82)"
    : T.surface;

  // Each action gets its own glass circle. Screens pass their actions as a
  // fragment or array; unwrap so every individual button is wrapped, not the
  // whole group.
  const rawActions =
    React.isValidElement(rightActions) && rightActions.type === React.Fragment
      ? (rightActions as React.ReactElement<{ children?: React.ReactNode }>).props.children
      : rightActions;
  const actionItems = React.Children.toArray(rawActions);

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      {showBack ? (
        <GlassIconButton
          onPress={onBack ?? (() => router.back())}
          accessibilityLabel="Back"
          size={SEGMENT}
          solidColor={glassSolid}
        >
          <ArrowLeft size={20} color={T.text} weight="bold" />
        </GlassIconButton>
      ) : null}

      <View
        style={[
          styles.pill,
          { borderColor: glassBorder },
          // A leading avatar/icon nests concentrically in the pill's rounded
          // corner when its left gap matches its vertical inset.
          (leading || IconComponent) && { paddingLeft: 4 },
        ]}
      >
        <GlassSurface
          style={StyleSheet.absoluteFill}
          tintColor={glassTint}
          interactive
          isDark={T.isDark}
          blurIntensity={40}
          solidColor={glassSolid}
        />
        {leading ??
          (IconComponent ? (
            <View style={[styles.iconWrap, { backgroundColor: color + "20" }]}>
              <IconComponent size={16} color={color} weight="bold" />
            </View>
          ) : null)}
        <View style={styles.titleText}>
          <Text style={[styles.title, { color: T.textBright }]} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: T.textDim }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {actionItems.length > 0 ? (
        <View style={styles.actions}>
          {actionItems.map((child, i) => (
            <View key={i} style={[styles.actionCircle, { borderColor: glassBorder }]}>
              <GlassSurface
                style={StyleSheet.absoluteFill}
                tintColor={glassTint}
                interactive
                isDark={T.isDark}
                blurIntensity={40}
                solidColor={glassSolid}
              />
              {child}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  pill: {
    flex: 1,
    height: SEGMENT,
    borderRadius: SEGMENT / 2,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONT.regular,
    lineHeight: 14,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionCircle: {
    width: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
