import React, { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { CalendarBlank, Clock, MapPin, Tag, Palette } from "phosphor-react-native";
import { MentionTextInput } from "@/components/MentionTextInput";
import { router } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import { DOMAIN_COLORS } from "@/constants/theme";
import { useCalendars, useCategories } from "@/hooks/useCalendar";
import { useCreateEvent } from "@/hooks/useCalendarMutations";

function roundToNext30(date: Date): Date {
  const d = new Date(date);
  const mins = d.getMinutes();
  d.setMinutes(mins <= 30 ? 30 : 60, 0, 0);
  return d;
}

function formatDateForInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTimeForInput(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function parseDateTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00`);
}

function formatTimeDisplay(timeStr: string): string {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr;
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return m === "00" ? `${hour} ${ampm}` : `${hour}:${m} ${ampm}`;
}

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default function CreateEventScreen() {
  const T = useTheme();
  const calendarsQuery = useCalendars();
  const categoriesQuery = useCategories();
  const createEvent = useCreateEvent();

  const defaultStart = roundToNext30(new Date());
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000); // +1 hour

  const [title, setTitle] = useState("");
  const descriptionRef = useRef("");
  const [dateStr, setDateStr] = useState(formatDateForInput(defaultStart));
  const [startTime, setStartTime] = useState(formatTimeForInput(defaultStart));
  const [endTime, setEndTime] = useState(formatTimeForInput(defaultEnd));
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);

  const categories = categoriesQuery.data ?? [];
  const defaultCalendar = calendarsQuery.data?.find((c) => c.isDefault) ?? calendarsQuery.data?.[0];

  const canSave = title.trim().length > 0 && !createEvent.isPending;

  const handleSave = async () => {
    if (!canSave || !defaultCalendar) return;

    const start = parseDateTime(dateStr, startTime);
    const end = parseDateTime(dateStr, endTime);

    try {
      await createEvent.mutateAsync({
        title: title.trim(),
        description: descriptionRef.current.trim() || undefined,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        isAllDay,
        calendarId: defaultCalendar.id,
        categoryId: selectedCategoryId,
        location: location.trim() || undefined,
        meetingUrl: meetingUrl.trim() || undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      router.back();
    } catch {
      // Error handled by query
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="New Event"
        color={DOMAIN_COLORS.calendar}
        icon="calendar"
        rightActions={
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {createEvent.isPending ? (
              <ActivityIndicator size="small" color={T.accent} />
            ) : (
              <Text style={[styles.saveBtn, { color: canSave ? T.accent : T.textDim }]}>Save</Text>
            )}
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Title */}
        <TextInput
          style={[styles.titleInput, { color: T.textBright, borderBottomColor: T.border }]}
          value={title}
          onChangeText={setTitle}
          placeholder="Event title"
          placeholderTextColor={T.textDim}
          autoFocus
          returnKeyType="next"
        />

        {/* Date & Time */}
        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setIsAllDay((v) => !v)}
            activeOpacity={0.7}
          >
            <CalendarBlank size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>All day</Text>
            <View
              style={[styles.toggleTrack, isAllDay && { backgroundColor: DOMAIN_COLORS.calendar }]}
            >
              <View style={[styles.toggleThumb, isAllDay && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>

          <View style={[styles.fieldDivider, { backgroundColor: T.border }]} />

          <View style={styles.fieldRow}>
            <CalendarBlank size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldValue, { color: T.textBright }]}>
              {formatDateDisplay(dateStr)}
            </Text>
          </View>

          {!isAllDay && (
            <>
              <View style={[styles.fieldDivider, { backgroundColor: T.border }]} />
              <View style={styles.fieldRow}>
                <Clock size={18} color={T.textDim} weight="duotone" />
                <View style={styles.timeRow}>
                  <TouchableOpacity style={[styles.timeChip, { backgroundColor: T.pageBg }]}>
                    <Text style={[styles.timeChipText, { color: T.textBright }]}>
                      {formatTimeDisplay(startTime)}
                    </Text>
                  </TouchableOpacity>
                  <Text style={[styles.timeDash, { color: T.textDim }]}>-</Text>
                  <TouchableOpacity style={[styles.timeChip, { backgroundColor: T.pageBg }]}>
                    <Text style={[styles.timeChipText, { color: T.textBright }]}>
                      {formatTimeDisplay(endTime)}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Quick duration selectors */}
              <View style={styles.durationRow}>
                {[30, 60, 90, 120].map((mins) => {
                  const label = mins < 60 ? `${mins}m` : `${mins / 60}h`;
                  return (
                    <TouchableOpacity
                      key={mins}
                      style={[styles.durationChip, { borderColor: T.border }]}
                      onPress={() => {
                        const start = parseDateTime(dateStr, startTime);
                        const end = new Date(start.getTime() + mins * 60 * 1000);
                        setEndTime(formatTimeForInput(end));
                      }}
                    >
                      <Text style={[styles.durationText, { color: T.textDim }]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </View>

        {/* Category */}
        {categories.length > 0 && (
          <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={styles.fieldRow}>
              <Palette size={18} color={T.textDim} weight="duotone" />
              <Text style={[styles.fieldLabel, { color: T.textBright }]}>Category</Text>
            </View>
            <View style={styles.categoryGrid}>
              {categories.map((cat) => {
                const isSelected = selectedCategoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryChip,
                      { borderColor: isSelected ? cat.color : T.border },
                      isSelected && { backgroundColor: cat.color + "18" },
                    ]}
                    onPress={() => setSelectedCategoryId(isSelected ? undefined : cat.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.categoryDot, { backgroundColor: cat.color }]} />
                    <Text
                      style={[
                        styles.categoryChipText,
                        { color: isSelected ? T.textBright : T.textDim },
                      ]}
                      numberOfLines={1}
                    >
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Location */}
        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={styles.fieldRow}>
            <MapPin size={18} color={T.textDim} weight="duotone" />
            <TextInput
              style={[styles.fieldInput, { color: T.textBright }]}
              value={location}
              onChangeText={setLocation}
              placeholder="Add location"
              placeholderTextColor={T.textDim}
            />
          </View>
          <View style={[styles.fieldDivider, { backgroundColor: T.border }]} />
          <View style={styles.fieldRow}>
            <Tag size={18} color={T.textDim} weight="duotone" />
            <TextInput
              style={[styles.fieldInput, { color: T.textBright }]}
              value={meetingUrl}
              onChangeText={setMeetingUrl}
              placeholder="Add meeting URL"
              placeholderTextColor={T.textDim}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        </View>

        {/* Description */}
        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <MentionTextInput
            style={[styles.descInput, { color: T.textBright }]}
            onCanonicalChange={(c) => {
              descriptionRef.current = c;
            }}
            placeholder="Add description..."
            placeholderTextColor={T.textDim}
          />
        </View>

        {/* Calendar indicator */}
        {defaultCalendar && (
          <View style={[styles.calendarRow, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View
              style={[
                styles.calendarDot,
                { backgroundColor: defaultCalendar.color || DOMAIN_COLORS.calendar },
              ]}
            />
            <Text style={[styles.calendarName, { color: T.textBright }]}>
              {defaultCalendar.name}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, gap: 16 },
  saveBtn: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  titleInput: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fieldCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  fieldLabel: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  fieldValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  fieldInput: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  fieldDivider: { height: StyleSheet.hairlineWidth, marginLeft: 44 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#555",
    justifyContent: "center",
    padding: 2,
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
  },
  toggleThumbOn: {
    alignSelf: "flex-end",
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  timeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  timeChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timeDash: { fontSize: 14 },
  durationRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 44,
    paddingBottom: 12,
  },
  durationChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  durationText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  descInput: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 14,
    minHeight: 80,
    lineHeight: 20,
  },
  calendarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  calendarDot: { width: 12, height: 12, borderRadius: 6 },
  calendarName: { fontSize: 14, fontFamily: "Inter_500Medium" },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  categoryDot: { width: 8, height: 8, borderRadius: 4 },
  categoryChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
});
