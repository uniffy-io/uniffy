import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Check, Prohibit } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import type { SerializedCategory } from "@features/calendar/calendarSerializer";

type CalendarFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  categories: SerializedCategory[];
  activeCategoryIds: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
};

export function CalendarFilterSheet({
  visible,
  onClose,
  categories,
  activeCategoryIds,
  onToggle,
  onClear,
}: CalendarFilterSheetProps) {
  const T = useTheme();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={[styles.header, { borderBottomColor: T.border }]}>
        <Text style={[styles.title, { color: T.textBright }]}>Filter by category</Text>
        {activeCategoryIds.size > 0 && (
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.clear, { color: T.accent }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView bounces={false} contentContainerStyle={styles.list}>
        {categories.length === 0 ? (
          <Text style={[styles.empty, { color: T.textDim }]}>No categories yet</Text>
        ) : (
          <>
            {/* Events without a category carry an empty id; without this row
                they vanish from every filtered view with no way back. */}
            {(() => {
              const active = activeCategoryIds.has("");
              return (
                <TouchableOpacity
                  style={[
                    styles.row,
                    {
                      borderColor: active ? T.accent : T.border,
                      backgroundColor: active ? T.accent + "18" : "transparent",
                    },
                  ]}
                  onPress={() => onToggle("")}
                  activeOpacity={0.7}
                >
                  <Prohibit size={14} color={T.textDim} weight="duotone" />
                  <Text style={[styles.name, { color: active ? T.textBright : T.text }]}>
                    Uncategorised
                  </Text>
                  {active && <Check size={16} color={T.accent} weight="bold" />}
                </TouchableOpacity>
              );
            })()}
            {categories.map((cat) => {
              const active = activeCategoryIds.has(cat.id);
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.row,
                    {
                      borderColor: active ? cat.color : T.border,
                      backgroundColor: active ? cat.color + "18" : "transparent",
                    },
                  ]}
                  onPress={() => onToggle(cat.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.dot, { backgroundColor: cat.color }]} />
                  <Text style={[styles.name, { color: active ? T.textBright : T.text }]}>
                    {cat.name}
                  </Text>
                  {active && <Check size={16} color={cat.color} weight="bold" />}
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 15,
    fontFamily: FONT.semibold,
  },
  clear: {
    fontSize: 13,
    fontFamily: FONT.semibold,
  },
  list: {
    padding: 12,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { flex: 1, fontSize: 15, fontFamily: FONT.medium },
  empty: {
    fontSize: 14,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 24,
  },
});
