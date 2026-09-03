import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BookmarkSimple, Tag } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";

export type LibraryTab = "bookmarks" | "tags";

// The same glyphs the web's Library sidebar gives its sections.
const TABS: { key: LibraryTab; label: string; icon: React.ComponentType<any> }[] = [
  { key: "bookmarks", label: "Bookmarks", icon: BookmarkSimple },
  { key: "tags", label: "Tags", icon: Tag },
];

export function LibraryTabs({
  tab,
  onChange,
}: {
  tab: LibraryTab;
  onChange: (t: LibraryTab) => void;
}) {
  const T = useTheme();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = key === tab;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={styles.tab}
            hitSlop={{ top: 8, bottom: 8 }}
          >
            <Icon
              size={16}
              color={active ? T.accent : T.textDim}
              weight={active ? "fill" : "duotone"}
            />
            <Text
              style={[
                styles.label,
                active
                  ? { color: T.textBright, fontFamily: FONT.semibold }
                  : { color: T.textDim, fontFamily: FONT.medium },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 22,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  tab: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontSize: 14 },
});
