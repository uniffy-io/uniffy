import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { CaretDown, CaretRight, ListBullets } from "phosphor-react-native";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { Heading } from "@features/notes/noteOutline";

// Headings deeper than this share the deepest indent - past three levels the
// stagger eats the row width on a phone without telling the reader anything.
const MAX_INDENT_LEVEL = 3;

export function NoteOutline({
  headings,
  onJump,
}: {
  headings: Heading[];
  onJump: (headingIndex: number) => void;
}) {
  const T = useTheme();
  const [expanded, setExpanded] = useState(true);

  if (headings.length < 2) return null;

  const topLevel = Math.min(...headings.map((h) => h.level));

  return (
    <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <ListBullets size={15} color={T.accent} weight="duotone" />
        <Text style={[styles.headerLabel, { color: T.textBright }]}>Outline</Text>
        <Text style={[styles.headerCount, { color: T.textDim }]}>{headings.length}</Text>
        {expanded ? (
          <CaretDown size={13} color={T.textDim} weight="bold" />
        ) : (
          <CaretRight size={13} color={T.textDim} weight="bold" />
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.list}>
          {headings.map((heading, i) => {
            const depth = Math.min(heading.level - topLevel, MAX_INDENT_LEVEL);
            const isTop = depth === 0;
            return (
              <TouchableOpacity
                key={`${heading.text}-${i}`}
                style={[styles.row, { paddingLeft: depth * 14 }]}
                onPress={() => onJump(i)}
                activeOpacity={0.6}
              >
                <View
                  style={[
                    styles.rail,
                    {
                      backgroundColor: isTop ? T.accent : T.border,
                      height: isTop ? 14 : 10,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.rowText,
                    {
                      color: isTop ? T.textBright : T.text,
                      fontFamily: isTop ? FONT.semibold : FONT.regular,
                      fontSize: isTop ? 14 : 13,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {heading.text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLabel: { flex: 1, fontSize: 13, fontFamily: FONT.semibold, letterSpacing: 0.3 },
  headerCount: { fontSize: 12, fontFamily: FONT.medium },
  list: { paddingBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 14,
    paddingVertical: 7,
    marginLeft: 14,
  },
  rail: { width: 2, borderRadius: 1 },
  rowText: { flex: 1, lineHeight: 19 },
});
