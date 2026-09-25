import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { User } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { SerializedView } from "@features/projects/projectsSerializer";

/** The project's views as a tab row; a personal view wears a person mark, an edited one a dot. */
export function ViewTabs({
  views,
  activeId,
  dirty,
  onSelect,
  onLongPress,
}: {
  views: SerializedView[];
  activeId: string | undefined;
  dirty: boolean;
  onSelect: (viewId: string) => void;
  onLongPress: (view: SerializedView) => void;
}) {
  const T = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const tabX = useRef(new Map<string, number>());

  // A view opened from a link, a relaunch or a save can sit past the edge of the row.
  const reveal = (viewId: string | undefined, animated: boolean) => {
    const x = viewId ? tabX.current.get(viewId) : undefined;
    if (x !== undefined) scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated });
  };

  useEffect(() => {
    reveal(activeId, true);
  }, [activeId]);

  return (
    <View style={[styles.bar, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        {views.map((view) => {
          const isActive = view.id === activeId;
          const color = isActive ? "#fff" : T.textDim;
          return (
            <TouchableOpacity
              key={view.id}
              style={[
                styles.tab,
                isActive
                  ? { backgroundColor: T.accent }
                  : {
                      backgroundColor: T.surface,
                      borderColor: T.border,
                      borderWidth: StyleSheet.hairlineWidth,
                    },
              ]}
              onLayout={(event) => {
                tabX.current.set(view.id, event.nativeEvent.layout.x);
                if (isActive) reveal(view.id, false);
              }}
              onPress={() => onSelect(view.id)}
              onLongPress={() => onLongPress(view)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              {view.visibility === "personal" && <User size={12} color={color} weight="bold" />}
              <Text style={[styles.tabText, { color }]} numberOfLines={1}>
                {view.name}
              </Text>
              {isActive && dirty && <View style={[styles.dirtyDot, { backgroundColor: "#fff" }]} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderBottomWidth: StyleSheet.hairlineWidth },
  // Without flexGrow: 0 the row claims the rest of the column, not just its own height.
  scroll: { flexGrow: 0 },
  content: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 20,
    maxWidth: 220,
  },
  tabText: { fontSize: 13, fontFamily: FONT.medium, flexShrink: 1 },
  dirtyDot: { width: 6, height: 6, borderRadius: 3 },
});
