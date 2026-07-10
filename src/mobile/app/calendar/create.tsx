import React, { useState, useRef, useEffect } from "react";
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
import { CalendarPicker } from "@/components/CalendarPicker";
import { TimePicker } from "@/components/TimePicker";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@/components/DomainHeader";
import { useTheme } from "@/hooks/useTheme";
import { FONT } from "@/constants/typography";
import { useCategories, useEvent } from "@/hooks/useCalendar";
import { useCreateEvent, useUpdateEvent } from "@/hooks/useCalendarMutations";

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

export default function CreateEventScreen() {
  const T = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const isEditing = !!eventId;

  const categoriesQuery = useCategories();
  const eventQuery = useEvent(eventId);
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();

  const defaultStart = roundToNext30(new Date());
  const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000); // +1 hour

  const [title, setTitle] = useState("");
  const descriptionRef = useRef("");
  const [initialDescription, setInitialDescription] = useState<string | undefined>(undefined);
  const [dateStr, setDateStr] = useState(formatDateForInput(defaultStart));
  const [startTime, setStartTime] = useState(formatTimeForInput(defaultStart));
  const [endTime, setEndTime] = useState(formatTimeForInput(defaultEnd));
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [isAllDay, setIsAllDay] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);

  // Prefill once the event to edit has loaded.
  const prefilledRef = useRef(false);
  useEffect(() => {
    const event = eventQuery.data;
    if (!event || prefilledRef.current) return;
    prefilledRef.current = true;
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    setTitle(event.title);
    descriptionRef.current = event.description ?? "";
    setInitialDescription(event.description || undefined);
    setDateStr(formatDateForInput(start));
    setStartTime(formatTimeForInput(start));
    setEndTime(formatTimeForInput(end));
    setLocation(event.location ?? "");
    setMeetingUrl(event.meetingUrl ?? "");
    setIsAllDay(event.isAllDay);
    setSelectedCategoryId(event.categoryId || undefined);
  }, [eventQuery.data]);

  const categories = categoriesQuery.data ?? [];

  const isSaving = createEvent.isPending || updateEvent.isPending;
  const canSave = title.trim().length > 0 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;

    const start = parseDateTime(dateStr, startTime);
    const end = parseDateTime(dateStr, endTime);

    try {
      if (isEditing && eventId) {
        await updateEvent.mutateAsync({
          eventId,
          title: title.trim(),
          description: descriptionRef.current.trim(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          isAllDay,
          categoryId: selectedCategoryId,
          location: location.trim(),
          meetingUrl: meetingUrl.trim(),
        });
      } else {
        // calendarId is omitted - the backend resolves the user's default
        // calendar (calendar management RPCs are deprecated).
        await createEvent.mutateAsync({
          title: title.trim(),
          description: descriptionRef.current.trim() || undefined,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          isAllDay,
          categoryId: selectedCategoryId,
          location: location.trim() || undefined,
          meetingUrl: meetingUrl.trim() || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      }
      router.back();
    } catch {
      // Error handled by query
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={isEditing ? "Edit Event" : "New Event"}
        color={T.domains.calendar}
        icon="calendar"
        rightActions={
          <TouchableOpacity
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isSaving ? (
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
          autoFocus={!isEditing}
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
            <View style={[styles.toggleTrack, isAllDay && { backgroundColor: T.domains.calendar }]}>
              <View style={[styles.toggleThumb, isAllDay && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>

          <View style={[styles.fieldDivider, { backgroundColor: T.border }]} />

          <View style={styles.fieldRow}>
            <CalendarBlank size={18} color={T.textDim} weight="duotone" />
            <View style={{ flex: 1 }}>
              <CalendarPicker
                value={dateStr}
                onChange={(d) => d && setDateStr(d)}
                accentColor={T.domains.calendar}
              />
            </View>
          </View>

          {!isAllDay && (
            <>
              <View style={[styles.fieldDivider, { backgroundColor: T.border }]} />
              <View style={styles.fieldRow}>
                <Clock size={18} color={T.textDim} weight="duotone" />
                <View style={styles.timeRow}>
                  <TimePicker
                    value={startTime}
                    onChange={(t) => {
                      // keep the original duration when the start moves
                      const prevStart = parseDateTime(dateStr, startTime);
                      const prevEnd = parseDateTime(dateStr, endTime);
                      const durationMs = Math.max(0, prevEnd.getTime() - prevStart.getTime());
                      setStartTime(t);
                      const newEnd = new Date(parseDateTime(dateStr, t).getTime() + durationMs);
                      setEndTime(formatTimeForInput(newEnd));
                    }}
                    accentColor={T.domains.calendar}
                  />
                  <Text style={[styles.timeDash, { color: T.textDim }]}>-</Text>
                  <TimePicker
                    value={endTime}
                    onChange={setEndTime}
                    accentColor={T.domains.calendar}
                  />
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
            initialContent={initialDescription}
            onCanonicalChange={(c) => {
              descriptionRef.current = c;
            }}
            placeholder="Add description..."
            placeholderTextColor={T.textDim}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, gap: 16 },
  saveBtn: { fontSize: 16, fontFamily: FONT.semibold },
  titleInput: {
    fontSize: 22,
    fontFamily: FONT.bold,
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
  fieldLabel: { fontSize: 14, fontFamily: FONT.medium, flex: 1 },
  fieldValue: { fontSize: 14, fontFamily: FONT.medium },
  fieldInput: { fontSize: 14, fontFamily: FONT.regular, flex: 1 },
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
  timeChipText: { fontSize: 14, fontFamily: FONT.semibold },
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
  durationText: { fontSize: 12, fontFamily: FONT.medium },
  descInput: {
    fontSize: 14,
    fontFamily: FONT.regular,
    padding: 14,
    minHeight: 80,
    lineHeight: 20,
  },
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
  categoryChipText: { fontSize: 13, fontFamily: FONT.medium },
});
