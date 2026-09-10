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
  Alert,
} from "react-native";
import {
  ArrowsClockwise,
  Bell,
  CalendarBlank,
  CaretDown,
  Check,
  Clock,
  Copy,
  Crosshair,
  Door,
  Link,
  MapPin,
  Palette,
  Prohibit,
  Sliders,
  Tag,
  Users,
  VideoCamera,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "@shared/components/BottomSheet";
import { RichDescriptionInput } from "@shared/components/RichDescriptionInput";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { TimePicker } from "@features/calendar/components/TimePicker";
import { MeetingChannelPicker } from "@features/calendar/components/MeetingChannelPicker";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { RecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";
import { getEffectiveTimeZone } from "@core/datetimePrefs";
import { instantFromZonedWall, zonedParts } from "@shared/lib/zonedTime";
import { userFacingError } from "@shared/lib/userFacingError";
import { useCategories, useEvent, useEventTemplates } from "@features/calendar/useCalendar";
import { useCreateEvent, useUpdateEvent } from "@features/calendar/useCalendarMutations";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { useDirectory } from "@shared/directory/useDirectory";
import { TagPickerSheet } from "@features/tags/components/TagPickerSheet";
import { useTags } from "@features/tags/useTags";
import { RoomPickerSheet } from "@features/rooms/components/RoomPickerSheet";
import { useRooms } from "@features/rooms/useRooms";
import { EventStateOptions } from "@features/calendar/components/EventStateOptions";
import type { EventStateValue } from "@features/calendar/components/EventStateOptions";
import { ReminderChips } from "@features/calendar/components/ReminderChips";
import { RecurrenceSheet } from "@features/calendar/components/RecurrenceSheet";
import { TemplatePickerSheet } from "@features/calendar/components/TemplatePickerSheet";
import { recurrenceLabel } from "@features/calendar/eventDisplay";
import type {
  SerializedRecurrence,
  SerializedTemplate,
} from "@features/calendar/calendarSerializer";

type MeetingMode = "none" | "link" | "channel";

const MEETING_MODES = [
  { mode: "none", label: "None", Icon: Prohibit },
  { mode: "link", label: "Link", Icon: Link },
  { mode: "channel", label: "Uniffy meeting", Icon: VideoCamera },
] as const;

// Keyed by the raw route param, which carries the proto enum's numeric value.
const SCOPE_LABEL: Record<string, string | undefined> = {
  [RecurrenceEditScope.THIS_EVENT]: "This occurrence only",
  [RecurrenceEditScope.ALL_EVENTS]: "The entire series",
  [RecurrenceEditScope.THIS_AND_FOLLOWING]: "This and following events",
};

function roundToNext30(date: Date): Date {
  const d = new Date(date);
  const mins = d.getMinutes();
  d.setMinutes(mins <= 30 ? 30 : 60, 0, 0);
  return d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Inputs are wall-clock in the member's display zone, so instants convert
// through it in both directions - never through the device clock.
function formatDateForInput(instant: Date): string {
  const p = zonedParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function formatTimeForInput(instant: Date): string {
  const p = zonedParts(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function parseDateTime(dateStr: string, timeStr: string): Date {
  return instantFromZonedWall(dateStr, timeStr);
}

export function CreateEventScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  // date/start/end arrive from the day-view drag-to-create gesture.
  // recurrenceEditScope/occurrenceDate arrive when the edit was started from a
  // single occurrence of a series and the user already chose how far it reaches.
  const { eventId, date, start, end, recurrenceEditScope, occurrenceDate } = useLocalSearchParams<{
    eventId?: string;
    date?: string;
    start?: string;
    end?: string;
    recurrenceEditScope?: string;
    occurrenceDate?: string;
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
  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelAutoCreated, setChannelAutoCreated] = useState(false);
  const [isAllDay, setIsAllDay] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [isFocusTime, setIsFocusTime] = useState(false);
  const [reminders, setReminders] = useState<number[]>([]);
  const [recurrence, setRecurrence] = useState<SerializedRecurrence | undefined>(undefined);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [eventState, setEventState] = useState<EventStateValue>({
    status: "confirmed",
    visibility: "standard",
    transparency: "opaque",
    isOutOfOffice: false,
  });
  const [attendeePickerOpen, setAttendeePickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [recurrenceSheetOpen, setRecurrenceSheetOpen] = useState(false);
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const { byId: subjectsById } = useDirectory();
  const tagsQuery = useTags("");
  const roomsQuery = useRooms();
  const templatesQuery = useEventTemplates();

  // Prefill editable fields once the event to edit loads. Adjusting state during
  // render (guarded to run once) avoids an effect that would cascade a second render.
  const event = eventQuery.data;
  const [prefilled, setPrefilled] = useState(false);
  // GetEvent answers with the series row even when the id names an occurrence,
  // so its date is where the recurrence STARTED. The field has to show the day
  // that was opened instead, or a "this occurrence" save would stamp the
  // series' first date onto a later one.
  const [seriesDate, setSeriesDate] = useState<string | null>(null);
  if (event && !prefilled) {
    setPrefilled(true);
    const start = new Date(event.startTime);
    const end = new Date(event.endTime);
    setSeriesDate(formatDateForInput(start));
    setTitle(event.title);
    setInitialDescription(event.description || undefined);
    setDateStr(occurrenceDate || formatDateForInput(start));
    setStartTime(formatTimeForInput(start));
    setEndTime(formatTimeForInput(end));
    setLocation(event.location ?? "");
    setMeetingUrl(event.meetingUrl ?? "");
    setSelectedChannelId(event.channelId || null);
    setMeetingMode(event.channelId ? "channel" : event.meetingUrl ? "link" : "none");
    setIsAllDay(event.isAllDay);
    setSelectedCategoryId(event.categoryId || undefined);
    // Attendees are deliberately not prefilled: adding and removing people on
    // an existing event lives on the detail screen, where roles and responses
    // survive; a replace-the-list save here would drop both.
    setTagIds(event.tags.map((t) => t.id));
    setIsFocusTime(event.isFocusTime);
    setReminders([...event.reminders]);
    setRecurrence(event.recurrence);
    setRoomId(event.roomId ?? null);
    setEventState({
      status: event.status,
      visibility: event.visibility,
      transparency: event.transparency,
      isOutOfOffice: event.isOutOfOffice,
    });
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
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
  const activeMeetingMode = MEETING_MODES.find((m) => m.mode === meetingMode) ?? MEETING_MODES[0];
  const ActiveMeetingIcon = activeMeetingMode.Icon;

  const pickMeetingMode = (mode: MeetingMode) => {
    setMeetingPickerOpen(false);
    setMeetingMode(mode);
    // A link and a channel are mutually exclusive, so switching away drops the
    // binding the other mode owns rather than leaving it to be saved silently.
    if (mode !== "link") setMeetingUrl("");
    if (mode !== "channel") {
      setSelectedChannelId(null);
      setChannelAutoCreated(false);
    }
  };

  const attendeeNames = attendeeIds.map((id) => subjectsById.get(id)?.name ?? "…").join(", ");
  const tagNameById = new Map<string, string>();
  tagsQuery.data?.forEach((t) => tagNameById.set(t.id, t.name));
  eventQuery.data?.tags.forEach((t) => tagNameById.set(t.id, t.name));
  const selectedTagNames = tagIds.map((id) => tagNameById.get(id) ?? "…").join(", ");
  const selectedRoomName = roomId
    ? (roomsQuery.data?.find((r) => r.id === roomId)?.name ??
      eventQuery.data?.roomName ??
      "Selected")
    : null;
  const slotStartIso = parseDateTime(dateStr, startTime).toISOString();
  const slotEndIso = parseDateTime(dateStr, endTime).toISOString();

  const applyTemplate = (template: SerializedTemplate) => {
    setTitle(template.title);
    if (template.description) {
      descriptionRef.current = template.description;
      setInitialDescription(template.description);
    }
    if (template.location) setLocation(template.location);
    if (template.meetingUrl) {
      setMeetingMode("link");
      setMeetingUrl(template.meetingUrl);
    }
    if (template.categoryId) setSelectedCategoryId(template.categoryId);
    if (template.durationMinutes > 0) {
      const start = parseDateTime(dateStr, startTime);
      const end = new Date(start.getTime() + template.durationMinutes * 60 * 1000);
      setEndTime(formatTimeForInput(end));
    }
  };

  const isSaving = createEvent.isPending || updateEvent.isPending;
  const canSave = title.trim().length > 0 && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;

    const scope = recurrenceEditScope
      ? (Number(recurrenceEditScope) as RecurrenceEditScope)
      : undefined;
    // "All events" writes to the series row, so a date field the user never
    // touched must not drag the anchor forward onto whichever occurrence
    // happened to be open - that would strand every occurrence before it.
    const effectiveDate =
      scope === RecurrenceEditScope.ALL_EVENTS && dateStr === occurrenceDate && seriesDate
        ? seriesDate
        : dateStr;

    let start = parseDateTime(effectiveDate, startTime);
    let end = parseDateTime(effectiveDate, endTime);
    if (isAllDay) {
      // All-day spans the whole day (12:00 AM through 11:59 PM).
      start = parseDateTime(effectiveDate, "00:00");
      end = parseDateTime(effectiveDate, "23:59");
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
        const prev = eventQuery.data;
        const prevTagIds = (prev?.tags ?? []).map((t) => t.id);
        const tagsChanged =
          tagIds.length !== prevTagIds.length || tagIds.some((id) => !prevTagIds.includes(id));
        const prevReminders = prev?.reminders ?? [];
        const remindersChanged =
          reminders.length !== prevReminders.length ||
          reminders.some((r) => !prevReminders.includes(r));
        const recurrenceChanged =
          JSON.stringify(recurrence ?? null) !== JSON.stringify(prev?.recurrence ?? null);
        const prevRoomId = prev?.roomId ?? "";
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
          recurrenceEditScope: scope,
          occurrenceDate,
          isFocusTime: isFocusTime !== prev?.isFocusTime ? isFocusTime : undefined,
          reminders: remindersChanged ? reminders : undefined,
          // Dropping the rule cannot travel as "unset" (that means untouched),
          // so a cleared recurrence goes over as an explicit NONE.
          recurrence: recurrenceChanged
            ? (recurrence ?? { pattern: "NONE", interval: 1, daysOfWeek: [] })
            : undefined,
          roomId: (roomId ?? "") !== prevRoomId ? (roomId ?? "") : undefined,
          tagIds: tagsChanged ? tagIds : undefined,
          status: eventState.status !== prev?.status ? eventState.status : undefined,
          visibility:
            eventState.visibility !== prev?.visibility ? eventState.visibility : undefined,
          transparency:
            eventState.transparency !== prev?.transparency ? eventState.transparency : undefined,
          isOutOfOffice:
            eventState.isOutOfOffice !== prev?.isOutOfOffice ? eventState.isOutOfOffice : undefined,
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
          timezone: getEffectiveTimeZone(),
          attendees: attendeeIds.map((userId) => ({ userId })),
          tagIds,
          isFocusTime,
          // Empty means the server applies the user's reminder defaults.
          reminders: reminders.length > 0 ? reminders : undefined,
          recurrence,
          roomId: roomId ?? undefined,
          status: eventState.status !== "confirmed" ? eventState.status : undefined,
          visibility: eventState.visibility !== "standard" ? eventState.visibility : undefined,
          transparency: eventState.transparency !== "opaque" ? eventState.transparency : undefined,
          isOutOfOffice: eventState.isOutOfOffice,
        });
      }
      router.back();
    } catch (error) {
      Alert.alert("Could not save", userFacingError(error, "The event was not saved."));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={isEditing ? "Edit Event" : "New Event"}
        // The scope was chosen on the sheet that led here, so without this the
        // editor gives no sign of how far the save is about to reach.
        subtitle={SCOPE_LABEL[recurrenceEditScope ?? ""]}
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

        {!isEditing && (templatesQuery.data?.length ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.templateRow}
            onPress={() => setTemplatePickerOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Use a template"
          >
            <Copy size={15} color={T.accent} weight="duotone" />
            <Text style={[styles.templateRowText, { color: T.accent }]}>Use a template</Text>
          </TouchableOpacity>
        )}

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
            <TouchableOpacity
              style={styles.fieldRow}
              onPress={() => setCategoryPickerOpen(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Category: ${selectedCategory?.name ?? "None"}. Change`}
            >
              <Palette size={18} color={T.textDim} weight="duotone" />
              <Text style={[styles.fieldLabel, { color: T.textBright }]}>Category</Text>
              {selectedCategory ? (
                <View style={[styles.categoryDot, { backgroundColor: selectedCategory.color }]} />
              ) : null}
              <Text style={[styles.fieldValue, { color: T.textDim }]} numberOfLines={1}>
                {selectedCategory?.name ?? "None"}
              </Text>
              <CaretDown size={14} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          </View>
        )}

        {!isEditing && (
          <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <TouchableOpacity
              style={styles.fieldRow}
              onPress={() => setAttendeePickerOpen(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Invitees: ${attendeeIds.length}. Change`}
            >
              <Users size={18} color={T.textDim} weight="duotone" />
              <Text style={[styles.fieldLabel, { color: T.textBright }]}>Invitees</Text>
              <Text style={[styles.fieldValue, { color: T.textDim }]} numberOfLines={1}>
                {attendeeIds.length > 0 ? attendeeNames : "None"}
              </Text>
              <CaretDown size={14} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          </View>
        )}

        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => setRoomPickerOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Room: ${selectedRoomName ?? "None"}. Change`}
          >
            <Door size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Room</Text>
            <Text style={[styles.fieldValue, { color: T.textDim }]} numberOfLines={1}>
              {selectedRoomName ?? "None"}
            </Text>
            <CaretDown size={14} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>

        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => setRecurrenceSheetOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Repeat rule. Change"
          >
            <ArrowsClockwise size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Repeat</Text>
            <Text style={[styles.fieldValue, { color: T.textDim }]} numberOfLines={1}>
              {recurrence ? recurrenceLabel(recurrence) : "Never"}
            </Text>
            <CaretDown size={14} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>

        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={styles.fieldRow}>
            <Bell size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Reminders</Text>
          </View>
          <View style={styles.chipsBody}>
            <ReminderChips value={reminders} onChange={setReminders} />
            {!isEditing && reminders.length === 0 ? (
              <Text style={[styles.hintText, { color: T.textDim }]}>
                Your default reminders apply unless set
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => setTagPickerOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Tags: ${tagIds.length}. Change`}
          >
            <Tag size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Tags</Text>
            <Text style={[styles.fieldValue, { color: T.textDim }]} numberOfLines={1}>
              {tagIds.length > 0 ? selectedTagNames : "None"}
            </Text>
            <CaretDown size={14} color={T.textDim} weight="bold" />
          </TouchableOpacity>
        </View>

        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setIsFocusTime((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Focus time: ${isFocusTime ? "on" : "off"}`}
          >
            <Crosshair size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Focus time</Text>
            <View style={[styles.toggleTrack, isFocusTime && { backgroundColor: T.accent }]}>
              <View style={[styles.toggleThumb, isFocusTime && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>
        </View>

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
          <TouchableOpacity
            style={styles.fieldRow}
            onPress={() => setMeetingPickerOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Online meeting: ${activeMeetingMode.label}. Change`}
          >
            <VideoCamera size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Online meeting</Text>
            <ActiveMeetingIcon size={15} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldValue, { color: T.textDim }]} numberOfLines={1}>
              {activeMeetingMode.label}
            </Text>
            <CaretDown size={14} color={T.textDim} weight="bold" />
          </TouchableOpacity>

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

        <View style={[styles.fieldCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={styles.fieldRow}>
            <Sliders size={18} color={T.textDim} weight="duotone" />
            <Text style={[styles.fieldLabel, { color: T.textBright }]}>Options</Text>
          </View>
          <EventStateOptions value={eventState} onChange={setEventState} />
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

      <BottomSheet visible={categoryPickerOpen} onClose={() => setCategoryPickerOpen(false)}>
        <Text style={[styles.pickerSheetTitle, { color: T.textBright }]}>Category</Text>
        <TouchableOpacity
          style={[styles.pickerOption, { borderTopColor: T.border }]}
          onPress={() => {
            setCategoryPickerOpen(false);
            setSelectedCategoryId(undefined);
          }}
          activeOpacity={0.7}
        >
          <Prohibit size={18} color={T.textDim} weight="duotone" />
          <Text style={[styles.pickerOptionLabel, { color: T.textBright }]}>None</Text>
          {!selectedCategoryId ? <Check size={16} color={T.accent} weight="bold" /> : null}
        </TouchableOpacity>
        {categories.map((cat) => {
          const active = cat.id === selectedCategoryId;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[styles.pickerOption, { borderTopColor: T.border }]}
              onPress={() => {
                setCategoryPickerOpen(false);
                setSelectedCategoryId(cat.id);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.categoryDot, { backgroundColor: cat.color }]} />
              <Text style={[styles.pickerOptionLabel, { color: T.textBright }]}>{cat.name}</Text>
              {active ? <Check size={16} color={cat.color} weight="bold" /> : null}
            </TouchableOpacity>
          );
        })}
      </BottomSheet>

      <BottomSheet visible={meetingPickerOpen} onClose={() => setMeetingPickerOpen(false)}>
        <Text style={[styles.pickerSheetTitle, { color: T.textBright }]}>Online meeting</Text>
        {MEETING_MODES.map(({ mode, label, Icon }) => {
          const active = mode === meetingMode;
          return (
            <TouchableOpacity
              key={mode}
              style={[styles.pickerOption, { borderTopColor: T.border }]}
              onPress={() => pickMeetingMode(mode)}
              activeOpacity={0.7}
            >
              <Icon
                size={18}
                color={active ? T.accent : T.textDim}
                weight={active ? "fill" : "duotone"}
              />
              <Text style={[styles.pickerOptionLabel, { color: active ? T.accent : T.textBright }]}>
                {label}
              </Text>
              {active ? <Check size={16} color={T.accent} weight="bold" /> : null}
            </TouchableOpacity>
          );
        })}
      </BottomSheet>

      <SubjectPickerSheet
        visible={attendeePickerOpen}
        onClose={() => setAttendeePickerOpen(false)}
        title="Invite people"
        accentColor={T.accent}
        selectedIds={attendeeIds}
        onToggle={(userId) =>
          setAttendeeIds((prev) =>
            prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
          )
        }
      />

      <TagPickerSheet
        visible={tagPickerOpen}
        onClose={() => setTagPickerOpen(false)}
        selectedIds={tagIds}
        onToggle={(tagId) =>
          setTagIds((prev) =>
            prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
          )
        }
      />

      <RecurrenceSheet
        visible={recurrenceSheetOpen}
        onClose={() => setRecurrenceSheetOpen(false)}
        value={recurrence}
        onChange={setRecurrence}
        accentColor={T.accent}
      />

      <RoomPickerSheet
        visible={roomPickerOpen}
        onClose={() => setRoomPickerOpen(false)}
        selectedRoomId={roomId}
        onSelect={setRoomId}
        startIso={slotStartIso}
        endIso={slotEndIso}
        accentColor={T.accent}
      />

      <TemplatePickerSheet
        visible={templatePickerOpen}
        onClose={() => setTemplatePickerOpen(false)}
        onApply={applyTemplate}
        accentColor={T.accent}
      />
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
  // The label grows to push toggles right but never shrinks below its own
  // width - a long value ("Weekly on Mon, Fri · 10 times") truncates instead.
  fieldLabel: { fontSize: 14, fontFamily: FONT.medium, flexGrow: 1, flexShrink: 0 },
  fieldValue: { fontSize: 14, fontFamily: FONT.medium, flexShrink: 1 },
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
  categoryDot: { width: 8, height: 8, borderRadius: 4 },
  pickerOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pickerOptionLabel: { flex: 1, fontSize: 15, fontFamily: FONT.medium },
  pickerSheetTitle: {
    fontSize: 15,
    fontFamily: FONT.semibold,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  meetingBody: { paddingHorizontal: 14, paddingBottom: 14 },
  meetingInput: {
    fontSize: 14,
    fontFamily: FONT.regular,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  templateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  templateRowText: { fontSize: 13, fontFamily: FONT.semibold },
  chipsBody: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 8,
  },
  hintText: { fontSize: 12, fontFamily: FONT.regular },
});
