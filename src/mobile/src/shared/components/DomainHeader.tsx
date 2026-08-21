import React from "react";
import { View, Text, StyleSheet, Platform, useWindowDimensions } from "react-native";
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
const TITLE_LINE = 18;
const SUBTITLE_LINE = 14;
// Chosen so a title and a subtitle at the unscaled size fill exactly SEGMENT,
// which keeps the pill the height it has always been until the text outgrows it.
const PILL_PAD_Y = 3;

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
  // React Native scales fontSize with the reader's text-size setting but never a
  // lineHeight written in a style, so at a large setting the glyphs outgrow the
  // line box they were sized for and a fixed-height pill crops the subtitle.
  // Scaling the lines and the pill together keeps the header legible instead of
  // capping how large the text is allowed to get.
  const { fontScale } = useWindowDimensions();
  const titleLine = Math.round(TITLE_LINE * fontScale);
  const subtitleLine = Math.round(SUBTITLE_LINE * fontScale);
  const pillHeight = Math.max(
    SEGMENT,
    (subtitle ? titleLine + subtitleLine : titleLine) + PILL_PAD_Y * 2,
  );
  const IconComponent = icon in DOMAIN_ICON ? DOMAIN_ICON[icon as Domain] : null;
  const glassBorder = T.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
  const glassTint = T.isDark ? "rgba(20,22,34,0.22)" : "rgba(255,255,255,0.35)";
  const glassSolid = translucent
    ? T.isDark
      ? "rgba(22,24,36,0.78)"
      : "rgba(248,249,252,0.82)"
    : T.surface;

  // Each action gets its own glass segment. Screens pass their actions as a
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
          { borderColor: glassBorder, height: pillHeight, borderRadius: pillHeight / 2 },
          // A leading avatar nests concentrically in the pill's rounded corner
          // when its left gap matches its vertical inset. The bare domain icon
          // has no shape of its own, so it keeps the pill's normal inset.
          Boolean(leading) && { paddingLeft: 4 },
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
          (IconComponent ? <IconComponent size={18} color={color} weight="bold" /> : null)}
        <View style={styles.titleText}>
          <Text
            style={[styles.title, { color: T.textBright, lineHeight: titleLine }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: T.textDim, lineHeight: subtitleLine }]}
              numberOfLines={1}
            >
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
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  // Both line heights are supplied per render from TITLE_LINE / SUBTITLE_LINE
  // scaled by the reader's text size, so they are deliberately absent here.
  title: {
    fontSize: 15,
    fontFamily: FONT.semibold,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONT.regular,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  // Grows with its content instead of forcing a fixed circle: text actions
  // ("Save", "Read all") and grouped controls would otherwise be clipped by
  // overflow hidden. The padding is tuned so a bare 20px icon lands exactly on
  // ACTION and still reads as a circle, while wider content becomes a pill.
  actionCircle: {
    minWidth: ACTION,
    height: ACTION,
    borderRadius: ACTION / 2,
    paddingHorizontal: 6,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
