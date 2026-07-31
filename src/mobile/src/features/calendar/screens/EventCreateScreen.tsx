import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  CalendarBlank,
  Clock,
  MapPin,
  Palette,
  VideoCamera,
  Prohibit,
  Link,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RichDescriptionInput } from "@shared/components/RichDescriptionInput";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { TimePicker } from "@features/calendar/components/TimePicker";
import { MeetingChannelPicker } from "@features/calendar/components/MeetingChannelPicker";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { useCategories, useEvent } from "@features/calendar/useCalendar";
import { useCreateEvent, useUpdateEvent } from "@features/calendar/useCalendarMutations";

type MeetingMode = "none" | "link" | "channel";

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

export function CreateEventScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  // date/start/end arrive from the day-view drag-to-create gesture.
  const { eventId, date, start, end } = useLocalSearchParams<{
    eventId?: string;
    date?: string;
    start?: string;
    end?: string;
  }>();
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
  const [dateStr, setDateStr] = useState(date || formatDateForInput(defaultStart));
  const [startTime, setStartTime] = useState(start || formatTimeForInput(defaultStart));
  const [endTime, setEndTime] = useState(end || formatTimeForInput(defaultEnd));
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("none");
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelAutoCreated, setChannelAutoCreated] = useState(false);
  const [isAllDay, setIsAllDay] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);

  // Prefill editable fields once the event to edit loads. Adjusting state during
  // render (guarded to run once) avoids an effect that would cascade a second render.
  const event = eventQuery.data;
  const [prefilled, setPrefilled] = useState(false);
  if (event && !prefilled) {
    setPrefilled(true);
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    setTitle(event.title);
    setInitialDescription(event.description || undefined);
    setDateStr(formatDateForInput(start));
    setStartTime(formatTimeForInput(start));
    setEndTime(formatTimeForInput(end));
    setLocation(event.location ?? "");
    setMeetingUrl(event.meetingUrl ?? "");
    setSelectedChannelId(event.channelId || null);
    setMeetingMode(event.channelId ? "channel" : event.meetingUrl ? "link" : "none");
    setIsAllDay(event.isAllDay);
    setSelectedCategoryId(event.categoryId || undefined);
  }

  // The description is an uncontrolled ref; seed it once off the render path.
  const descSeededRef = useRef(false);
  useEffect(() => {
    if (event && !descSeededRef.current) {
      descSeededRef.current = true;
      descriptionRef.current = event.description ?? "";
    }
  }, [event]);

  const categories = categoriesQuery.data ?? [];

  const isSaving = createEvent.isPending || updateEvent.isPending;
  const canSave = title.trim().length > 0 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;

    let start = parseDateTime(dateStr, startTime);
    let end = parseDateTime(dateStr, endTime);
    if (isAllDay) {
      // All-day spans the whole day (12:00 AM through 11:59 PM).
      start = parseDateTime(dateStr, "00:00");
      end = parseDateTime(dateStr, "23:59");
    } else if (end.getTime() <= start.getTime()) {
      // An end at or before the start runs into the next day (e.g. 8 PM - 12 AM).
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    // A link and a channel are mutually exclusive; only the active mode's
    // binding is carried, the other side stays cleared.
    const trimmedUrl = meetingUrl.trim();
    const channelOut = meetingMode === "channel" ? selectedChannelId : null;

    try {
      if (isEditing && eventId) {
        // channel_id: unset leaves the binding untouched, "" clears it. Send
        // it only when it changed so an unrelated edit does not thrash it.
        const prevChannelId = eventQuery.data?.channelId || "";
        const desiredChannel = channelOut || "";
        await updateEvent.mutateAsync({
          eventId,
          title: title.trim(),
          description: descriptionRef.current.trim(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          isAllDay,
          categoryId: selectedCategoryId,
          location: location.trim(),
          meetingUrl: meetingMode === "link" ? trimmedUrl : "",
          channelId: desiredChannel !== prevChannelId ? desiredChannel : undefined,
          channelAutoCreated: channelOut ? channelAutoCreated : undefined,
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
          meetingUrl: meetingMode === "link" ? trimmedUrl || undefined : undefined,
          channelId: channelOut || undefined,
          channelAutoCreated: channelOut ? channelAutoCreated : undefined,
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
        color={T.accent}
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

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
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
            <View style={[styles.toggleTrack, isAllDay && { backgroundColor: T.accent }]}>
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
                accentColor={T.accent}
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
                    accentColor={T.accent}
                  />
                  <Text style={[styles.timeDash, { color: T.textDim }]}>-</Text>
                  <TimePicker value={endTime} onChange={setEndTime} accentColor={T.accent} />
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
        </View>

        {/* Online meeting */}
        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={styles.fieldRow}>
            <VideoCamera size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Online meeting</Text>
          </View>
          <View style={styles.meetingModeRow}>
            {(
              [
                { mode: "none", label: "None", Icon: Prohibit },
                { mode: "link", label: "Link", Icon: Link },
                { mode: "channel", label: "Uniffy meeting", Icon: VideoCamera },
              ] as const
            ).map(({ mode, label, Icon }) => {
              const active = meetingMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.meetingChip,
                    { borderColor: active ? T.accent : T.border },
                    active && { backgroundColor: T.accent },
                  ]}
                  onPress={() => {
                    setMeetingMode(mode);
                    if (mode !== "link") setMeetingUrl("");
                    if (mode !== "channel") {
                      setSelectedChannelId(null);
                      setChannelAutoCreated(false);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Icon
                    size={15}
                    color={active ? "#fff" : T.textDim}
                    weight={active ? "fill" : "duotone"}
                  />
                  <Text
                    style={[styles.meetingChipText, { color: active ? "#fff" : T.textDim }]}
                    numberOfLines={1}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {meetingMode === "link" && (
            <View style={styles.meetingBody}>
              <TextInput
                style={[
                  styles.meetingInput,
                  { color: T.textBright, backgroundColor: T.pageBg, borderColor: T.border },
                ]}
                value={meetingUrl}
                onChangeText={setMeetingUrl}
                placeholder="https://..."
                placeholderTextColor={T.textDim}
                autoCapitalize="none"
                keyboardType="url"
                autoCorrect={false}
              />
            </View>
          )}

          {meetingMode === "channel" && (
            <View style={styles.meetingBody}>
              <MeetingChannelPicker
                selectedChannelId={selectedChannelId}
                onSelect={(id) => {
                  setSelectedChannelId(id);
                  setChannelAutoCreated(false);
                }}
                onCreateRoom={(id) => {
                  setSelectedChannelId(id);
                  setChannelAutoCreated(true);
                }}
                eventTitle={title}
                accentColor={T.accent}
              />
            </View>
          )}
        </View>

        {/* Description */}
        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <RichDescriptionInput
            T={T}
            initialContent={initialDescription}
            onCanonicalChange={(c) => {
              descriptionRef.current = c;
            }}
            placeholder="Add description..."
            accentColor={T.accent}
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
  meetingModeRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  meetingChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  meetingChipText: { fontSize: 12, fontFamily: FONT.medium },
  meetingBody: { paddingHorizontal: 14, paddingBottom: 14 },
  meetingInput: {
    fontSize: 14,
    fontFamily: FONT.regular,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
