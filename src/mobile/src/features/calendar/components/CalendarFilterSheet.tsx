import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from "react-native";
import { Check } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();
  const T = useTheme();
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <View />
      </TouchableOpacity>
      <View style={[styles.sheet, { backgroundColor: T.surface, paddingBottom: bottomPad + 8 }]}>
        <View style={[styles.handle, { backgroundColor: T.border }]} />
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
            categories.map((cat) => {
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
            })
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 8,
    marginBottom: 4,
  },
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
