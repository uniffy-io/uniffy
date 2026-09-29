import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Check, Crosshair, Eye, EyeSlash, Prohibit, ShareNetwork } from "phosphor-react-native";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetSearchBar } from "@shared/components/SheetSearchBar";
import { useTheme } from "@shared/hooks/useTheme";
import { FONT } from "@theme/typography";
import { CALENDAR_SECTIONS } from "@features/calendar/calendarList";
import type { SerializedCalendar, SerializedCategory } from "@features/calendar/calendarSerializer";
import { useSetCalendarVisibility } from "@features/calendar/useCalendarMutations";
import { roleCanManage } from "@shared/permissions/contentRoles";

export interface FilterTag {
  id: string;
  name: string;
  color: string;
}

type CalendarFilterSheetProps = {
  visible: boolean;
  onClose: () => void;
  calendars: SerializedCalendar[];
  /** Opens sharing for a calendar; members without manage rights get a read-only view. */
  onShareCalendar: (calendar: SerializedCalendar) => void;
  categories: SerializedCategory[];
  activeCategoryIds: Set<string>;
  onToggle: (id: string) => void;
  tags: FilterTag[];
  activeTagIds: Set<string>;
  onToggleTag: (id: string) => void;
  focusOnly: boolean;
  onToggleFocus: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClear: () => void;
};

export function CalendarFilterSheet({
  visible,
  onClose,
  calendars,
  onShareCalendar,
  categories,
  activeCategoryIds,
  onToggle,
  tags,
  activeTagIds,
  onToggleTag,
  focusOnly,
  onToggleFocus,
  searchQuery,
  onSearchChange,
  onClear,
}: CalendarFilterSheetProps) {
  const T = useTheme();
  const setVisibility = useSetCalendarVisibility();
  const anyActive =
    activeCategoryIds.size > 0 || activeTagIds.size > 0 || focusOnly || searchQuery.length > 0;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={[styles.header, { borderBottomColor: T.border }]}>
        <Text style={[styles.title, { color: T.textBright }]}>Calendars and filters</Text>
        {anyActive && (
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.clear, { color: T.accent }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      <ScrollView bounces={false} contentContainerStyle={styles.list} style={{ maxHeight: 460 }}>
        {/* Showing and hiding is saved for the member, unlike the filters
            below, so Clear leaves it alone. */}
        {CALENDAR_SECTIONS.map(({ section, title }) => {
          const rows = calendars.filter((calendar) => calendar.section === section);
          if (rows.length === 0) return null;
          return (
            <React.Fragment key={section}>
              <Text style={[styles.sectionLabel, { color: T.textDim }]}>{title.toUpperCase()}</Text>
              {rows.map((calendar) => {
                const shown = !calendar.isHidden;
                const EyeIcon = shown ? Eye : EyeSlash;
                return (
                  <TouchableOpacity
                    key={calendar.id}
                    style={[
                      styles.row,
                      {
                        borderColor: shown ? calendar.color : T.border,
                        backgroundColor: shown ? calendar.color + "18" : "transparent",
                      },
                    ]}
                    onPress={() => setVisibility.mutate({ calendarId: calendar.id, hidden: shown })}
                    activeOpacity={0.7}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: shown }}
                    accessibilityLabel={`Show ${calendar.label}`}
                  >
                    <View
                      style={[
                        styles.dot,
                        styles.calendarDot,
                        {
                          borderColor: calendar.color,
                          backgroundColor: shown ? calendar.color : "transparent",
                        },
                      ]}
                    />
                    <Text
                      style={[styles.name, { color: shown ? T.textBright : T.textDim }]}
                      numberOfLines={1}
                    >
                      {calendar.label}
                    </Text>
                    <EyeIcon
                      size={16}
                      color={shown ? calendar.color : T.textDim}
                      weight="duotone"
                    />
                    <TouchableOpacity
                      onPress={() => onShareCalendar(calendar)}
                      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        roleCanManage(calendar.userRole)
                          ? `Share ${calendar.label}`
                          : `Who has access to ${calendar.label}`
                      }
                    >
                      <ShareNetwork size={16} color={T.textDim} weight="duotone" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </React.Fragment>
          );
        })}

        <Text style={[styles.sectionLabel, { color: T.textDim }]}>FILTERS</Text>
        <SheetSearchBar
          value={searchQuery}
          onChangeText={onSearchChange}
          placeholder="Search title or description"
        />
        <TouchableOpacity
          style={[
            styles.row,
            {
              borderColor: focusOnly ? T.accent : T.border,
              backgroundColor: focusOnly ? T.accent + "18" : "transparent",
            },
          ]}
          onPress={onToggleFocus}
          activeOpacity={0.7}
        >
          <Crosshair size={14} color={focusOnly ? T.accent : T.textDim} weight="duotone" />
          <Text style={[styles.name, { color: focusOnly ? T.textBright : T.text }]}>
            Focus time only
          </Text>
          {focusOnly && <Check size={16} color={T.accent} weight="bold" />}
        </TouchableOpacity>

        <Text style={[styles.sectionLabel, { color: T.textDim }]}>CATEGORIES</Text>
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

        {tags.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>TAGS</Text>
            {tags.map((tag) => {
              const active = activeTagIds.has(tag.id);
              return (
                <TouchableOpacity
                  key={tag.id}
                  style={[
                    styles.row,
                    {
                      borderColor: active ? tag.color : T.border,
                      backgroundColor: active ? tag.color + "18" : "transparent",
                    },
                  ]}
                  onPress={() => onToggleTag(tag.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.dot, { backgroundColor: tag.color }]} />
                  <Text style={[styles.name, { color: active ? T.textBright : T.text }]}>
                    {tag.name}
                  </Text>
                  {active && <Check size={16} color={tag.color} weight="bold" />}
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
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
    paddingTop: 8,
    paddingHorizontal: 2,
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
  calendarDot: { borderWidth: 2 },
  name: { flex: 1, fontSize: 15, fontFamily: FONT.medium },
  empty: {
    fontSize: 14,
    fontFamily: FONT.regular,
    textAlign: "center",
    paddingVertical: 24,
  },
});
