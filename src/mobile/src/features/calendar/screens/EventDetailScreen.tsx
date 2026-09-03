import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Linking,
  Alert,
  useWindowDimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  ArrowsClockwise,
  Bell,
  CaretDown,
  CaretRight,
  Clock,
  Door,
  DotsThree,
  MapPin,
  Users,
  Video,
} from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader, domainHeaderHeight } from "@shared/components/DomainHeader";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { AttendeeStatus, RecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";
import { RecurrenceScopeSheet } from "@features/calendar/components/RecurrenceScopeSheet";
import { useAuth } from "@core/providers/AuthContext";
import { roleCanDelete, roleCanEdit } from "@shared/permissions/contentRoles";
import { userFacingError } from "@shared/lib/userFacingError";
import { useEvent, useCategories } from "@features/calendar/useCalendar";
import { formatCalendarDate, OCCURRENCE_SEPARATOR } from "@features/calendar/calendarSerializer";
import { zonedDayKey } from "@shared/lib/zonedTime";
import { RSVP_COLORS, RSVP_OPTIONS } from "@features/calendar/rsvp";
import { eventDisplayState, recurrenceLabel } from "@features/calendar/eventDisplay";
import {
  useAddAttendees,
  useCreateEventTemplate,
  useDeleteEvent,
  useRemoveAttendees,
  useUpdateAttendeeStatus,
  useUpdateEvent,
} from "@features/calendar/useCalendarMutations";
import { BottomSheet } from "@shared/components/BottomSheet";
import { SheetHeader } from "@shared/components/SheetHeader";
import { ReminderChips, reminderLabel } from "@features/calendar/components/ReminderChips";
import { EventActivityList } from "@features/calendar/components/EventActivityList";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { useCall } from "@features/calls/CallContext";
import { useActiveCall } from "@features/calls/useCallsState";

export function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const headerHeight = domainHeaderHeight(insets.top, fontScale);
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [invitePickerOpen, setInvitePickerOpen] = useState(false);
  const [scopeAction, setScopeAction] = useState<"edit" | "delete" | null>(null);
  const [reminderSheetOpen, setReminderSheetOpen] = useState(false);
  const [draftReminders, setDraftReminders] = useState<number[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const { user } = useAuth();
  const eventQuery = useEvent(id);
  const categoriesQuery = useCategories();
  const deleteEvent = useDeleteEvent();
  const addAttendees = useAddAttendees();
  const removeAttendees = useRemoveAttendees();
  const updateAttendeeStatus = useUpdateAttendeeStatus();
  const updateEvent = useUpdateEvent();
  const createTemplate = useCreateEventTemplate();
  const activeMeetingCall = useActiveCall(eventQuery.data?.channelId ?? undefined);
  const { openPrejoin } = useCall();
  const openMeetingPrejoin = () => {
    const meeting = eventQuery.data;
    if (!meeting?.channelId) return;
    openPrejoin({
      channelId: meeting.channelId,
      channelName: meeting.title,
      callId: activeMeetingCall?.id,
    });
  };

  // The route param is the only place the occurrence survives: GetEvent parses
  // the suffix off and answers with the series row, so nothing in the response
  // knows which day was tapped.
  const [masterId, occurrenceDate] = (id ?? "").split(OCCURRENCE_SEPARATOR);
  const eventUrn = `urn:uniffy:content:CALENDAR_EVENT:${masterId}`;
  const bookmarked = useIsBookmarked(eventUrn).data ?? false;
  const toggleBookmark = useToggleBookmark();

  const copyReferenceLink = useCallback(async () => {
    await Clipboard.setStringAsync(eventUrn);
    Alert.alert("Copied", "Reference link copied to clipboard.");
  }, [eventUrn]);

  const organizerId = eventQuery.data?.organizerId;
  const eventId = eventQuery.data?.id;
  const toggleAttendee = useCallback(
    (userId: string, isAttendee: boolean) => {
      if (!eventId) return;
      // The organizer is an attendee row like any other, so the picker offers
      // it as deselectable. Removing it would leave the event without the
      // person who owns it.
      if (userId === organizerId) {
        Alert.alert("Organizer", "The organizer cannot be removed from the event.");
        return;
      }
      const args = { eventId, userIds: [userId] };
      const callbacks = {
        onError: (error: unknown) =>
          Alert.alert(
            "Could not update attendees",
            userFacingError(error, "The change was not saved."),
          ),
      };
      if (isAttendee) removeAttendees.mutate(args, callbacks);
      else addAttendees.mutate(args, callbacks);
    },
    [eventId, organizerId, addAttendees, removeAttendees],
  );

  if (eventQuery.isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: T.pageBg }]}>
        <DomainHeader title="Calendar" color={T.accent} icon="calendar" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      </View>
    );
  }

  const event = eventQuery.data;
  if (!event) return null;

  // Get event color from category
  const category = categoriesQuery.data?.find((c) => c.id === event.categoryId);
  const eventColor = category?.color || T.accent;

  // Attendee ids ARE user ids (proto `Attendee.id`), so they feed the picker's
  // selection and the add/remove calls without a lookup.
  const attendeeIds = event.attendees.map((a) => a.id);

  // Advisory affordance gating from the server-resolved role; the backend
  // stays the gate either way. Without it a viewer taps Edit, the save is
  // refused, and the app looks like it lied.
  const canEdit = roleCanEdit(event.userRole);
  const canDelete = roleCanDelete(event.userRole);
  const ownAttendee = event.attendees.find((a) => a.id === user?.id);

  const display = eventDisplayState(event);
  const hasMeetingUrl = !!event.meetingUrl;
  const hasChannel = !!event.channelId;
  const isRecurring = !!event.recurrence;
  const recurrenceText = recurrenceLabel(event.recurrence);

  const stateBadges: { label: string; color: string }[] = [
    ...(display.cancelled ? [{ label: "Cancelled", color: T.red }] : []),
    ...(display.tentative ? [{ label: "Tentative", color: T.yellow }] : []),
    ...(event.visibility === "private" ? [{ label: "Private", color: T.textDim }] : []),
    ...(display.free ? [{ label: "Free", color: T.textDim }] : []),
    ...(display.outOfOffice ? [{ label: "Out of office", color: T.accent }] : []),
  ];

  // The series' own first date arrives under the plain master id, so the
  // occurrence suffix alone cannot decide: every recurring event asks for a
  // scope, and without a suffix "this event" means the first occurrence.
  const needsScope = isRecurring;
  const scopeDate = occurrenceDate ?? zonedDayKey(event.startTime);

  // The series row carries the date the recurrence STARTED, so an occurrence
  // opened from any later day would otherwise be labelled with the first one -
  // and "This event" in the scope sheet would name a day that is not on screen.
  const dateLabel = occurrenceDate ? formatCalendarDate(occurrenceDate) : event.dateFormatted;

  // An all-day event has no clock face: its hours are midnight-to-midnight
  // bookkeeping, so the span reads as dates and the hour count is dropped.
  const endDayKey = event.endTime ? zonedDayKey(event.endTime) : undefined;
  const allDayLabel =
    endDayKey && endDayKey !== zonedDayKey(event.startTime)
      ? `${dateLabel} – ${formatCalendarDate(endDayKey)}`
      : dateLabel;

  const editEvent = (scope?: RecurrenceEditScope) =>
    router.push({
      pathname: "/calendar/create",
      params: {
        eventId: id,
        ...(scope !== undefined
          ? { recurrenceEditScope: String(scope), occurrenceDate: scopeDate }
          : {}),
      },
    });

  const removeEvent = (scope?: RecurrenceEditScope) => {
    deleteEvent.mutate(
      {
        eventId: id,
        recurrenceEditScope: scope,
        occurrenceDate: scope === undefined ? undefined : scopeDate,
      },
      {
        onSuccess: () => router.back(),
        onError: (error) =>
          Alert.alert("Could not delete", userFacingError(error, "The event was not deleted.")),
      },
    );
  };

  const respond = (status: AttendeeStatus) => {
    updateAttendeeStatus.mutate(
      { eventId: event.id, status },
      {
        onError: (error) =>
          Alert.alert("Could not respond", userFacingError(error, "Your response was not saved.")),
      },
    );
  };

  const saveReminders = () => {
    updateEvent.mutate(
      { eventId: event.id, reminders: draftReminders },
      {
        onSuccess: () => setReminderSheetOpen(false),
        onError: (error) =>
          Alert.alert("Could not save", userFacingError(error, "The reminders were not saved.")),
      },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      {/* The header floats over the page so the event scrolls under its glass;
          the content starts beneath it by the header's computed height. */}
      <View style={styles.headerOverlay}>
        <DomainHeader
          title="Calendar"
          color={T.accent}
          icon="calendar"
          translucent
          rightActions={
            <>
              <CommentButton
                contentType={ContentType.CALENDAR_EVENT}
                contentId={event.id}
                color={T.accent}
              />
              <ShareButton
                contentType={ContentType.CALENDAR_EVENT}
                contentId={event.id}
                color={T.accent}
              />
              <TouchableOpacity
                onPress={() => setSheetOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <DotsThree size={22} color={T.text} weight="bold" />
              </TouchableOpacity>
            </>
          }
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: headerHeight + 20, paddingBottom: bottomPad },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleSection}>
          <View style={[styles.colorBar, { backgroundColor: eventColor }]} />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.title,
                { color: T.textBright },
                display.cancelled && styles.struckTitle,
              ]}
            >
              {display.title}
            </Text>
            {isRecurring && (
              <View
                style={[
                  styles.recurringBadge,
                  { backgroundColor: T.surface, borderColor: T.border },
                ]}
              >
                <ArrowsClockwise size={10} color={T.textDim} weight="duotone" />
                <Text style={[styles.recurringText, { color: T.textDim }]}>{recurrenceText}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Category badge */}
        {category && (
          <View
            style={[
              styles.categoryBadge,
              { backgroundColor: eventColor + "14", borderColor: eventColor + "30" },
            ]}
          >
            <View style={[styles.categoryBadgeDot, { backgroundColor: eventColor }]} />
            <Text style={[styles.categoryBadgeText, { color: eventColor }]}>{category.name}</Text>
          </View>
        )}

        {stateBadges.length > 0 && (
          <View style={styles.stateBadgeRow}>
            {stateBadges.map((badge) => (
              <View
                key={badge.label}
                style={[styles.stateBadge, { backgroundColor: badge.color + "1E" }]}
              >
                <Text style={[styles.stateBadgeText, { color: badge.color }]}>{badge.label}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={[styles.infoCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: eventColor + "20" }]}>
              <Clock size={14} color={eventColor} weight="duotone" />
            </View>
            <View>
              <Text style={[styles.infoMain, { color: T.textBright }]}>
                {event.isAllDay
                  ? "All day"
                  : `${event.startTimeFormatted} – ${event.endTimeFormatted}`}
              </Text>
              <Text style={[styles.infoSub, { color: T.textDim }]}>
                {event.isAllDay ? allDayLabel : `${dateLabel} · ${event.duration}`}
              </Text>
            </View>
          </View>
          {event.location ? (
            <>
              <View style={[styles.infoDivider, { backgroundColor: T.border }]} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: T.accent + "20" }]}>
                  <MapPin size={14} color={T.accent} weight="duotone" />
                </View>
                <Text style={[styles.infoMain, { color: T.textBright }]}>{event.location}</Text>
              </View>
            </>
          ) : null}
          {hasMeetingUrl && (
            <>
              <View style={[styles.infoDivider, { backgroundColor: T.border }]} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: "#40C05720" }]}>
                  <Video size={14} color="#40C057" weight="duotone" />
                </View>
                <TouchableOpacity onPress={() => Linking.openURL(event.meetingUrl!)}>
                  <Text style={[styles.infoMain, { color: T.accent }]}>Join Meeting</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          {hasChannel && (
            <>
              <View style={[styles.infoDivider, { backgroundColor: T.border }]} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIcon, { backgroundColor: "#40C05720" }]}>
                  <Video size={14} color="#40C057" weight="duotone" />
                </View>
                <TouchableOpacity onPress={openMeetingPrejoin}>
                  <Text
                    style={[styles.infoMain, { color: activeMeetingCall ? "#F43F5E" : T.accent }]}
                  >
                    {activeMeetingCall ? "Join live meeting" : "Join meeting"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
          {event.reminders.length > 0 || canEdit ? (
            <>
              <View style={[styles.infoDivider, { backgroundColor: T.border }]} />
              <TouchableOpacity
                style={styles.infoRow}
                disabled={!canEdit}
                onPress={() => {
                  setDraftReminders([...event.reminders]);
                  setReminderSheetOpen(true);
                }}
                activeOpacity={0.7}
                accessibilityRole={canEdit ? "button" : undefined}
                accessibilityLabel="Reminders"
              >
                <View style={[styles.infoIcon, { backgroundColor: T.accent + "20" }]}>
                  <Bell size={14} color={T.accent} weight="duotone" />
                </View>
                <Text style={[styles.infoMain, { color: T.textBright, flex: 1 }]}>
                  {event.reminders.length > 0
                    ? event.reminders.map(reminderLabel).join(", ")
                    : "No reminders"}
                </Text>
                {canEdit ? <CaretDown size={14} color={T.textDim} weight="bold" /> : null}
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {event.roomName ? (
          <View style={[styles.roomCard, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={styles.roomHeader}>
              <Door size={16} color={T.accent} weight="duotone" />
              <Text style={[styles.roomName, { color: T.textBright }]}>{event.roomName}</Text>
            </View>
            <View style={styles.roomMetaRow}>
              {event.roomLocation ? (
                <View style={styles.roomMeta}>
                  <MapPin size={12} color={T.textDim} />
                  <Text style={[styles.roomMetaText, { color: T.textDim }]}>
                    {event.roomLocation}
                  </Text>
                </View>
              ) : null}
              {event.roomCapacity && event.roomCapacity > 0 ? (
                <View style={styles.roomMeta}>
                  <Users size={12} color={T.textDim} />
                  <Text style={[styles.roomMetaText, { color: T.textDim }]}>
                    {event.roomCapacity} {event.roomCapacity === 1 ? "person" : "people"}
                  </Text>
                </View>
              ) : null}
            </View>
            {event.roomAmenities.length > 0 ? (
              <View style={styles.roomAmenities}>
                {event.roomAmenities.map((amenity) => (
                  <View
                    key={amenity}
                    style={[styles.amenityChip, { backgroundColor: T.accentSoft }]}
                  >
                    <Text style={[styles.amenityText, { color: T.textDim }]}>{amenity}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* The server refuses responses on cancelled events, so no bar to tap. */}
        {ownAttendee && !display.cancelled && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>YOUR RESPONSE</Text>
            <View style={styles.rsvpRow}>
              {RSVP_OPTIONS.map((option) => {
                const active = ownAttendee.status === option.status;
                const color = RSVP_COLORS[option.status];
                return (
                  <TouchableOpacity
                    key={option.status}
                    style={[
                      styles.rsvpOption,
                      {
                        borderColor: active ? color : T.border,
                        backgroundColor: active ? color + "18" : T.surface,
                      },
                    ]}
                    onPress={() => respond(option.proto)}
                    disabled={updateAttendeeStatus.isPending}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.rsvpOptionText, { color: active ? color : T.textBright }]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {event.attendees.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>
              ATTENDEES · {event.attendees.length}
            </Text>
            {event.attendees.map((att) => {
              const statusColor = RSVP_COLORS[att.status] ?? RSVP_COLORS.pending;
              return (
                <View key={att.id} style={[styles.attendeeRow, { borderBottomColor: T.border }]}>
                  <View style={[styles.attendeeAvatar, { backgroundColor: T.accent + "22" }]}>
                    <Text style={[styles.attendeeInitial, { color: T.accent }]}>
                      {att.initials}
                    </Text>
                  </View>
                  <Text style={[styles.attendeeName, { color: T.textBright }]}>{att.name}</Text>
                  <View style={[styles.rsvpBadge, { backgroundColor: statusColor + "20" }]}>
                    <Text style={[styles.rsvpText, { color: statusColor }]}>{att.status}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {event.description ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>DESCRIPTION</Text>
            <MarkdownRenderer content={event.description} />
          </View>
        ) : null}

        {event.linkedResources.length > 0 && (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>
              LINKED RESOURCES · {event.linkedResources.length}
            </Text>
            {event.linkedResources.map((res) => (
              <TouchableOpacity
                key={res.id}
                style={[styles.linkedRow, { backgroundColor: T.surface, borderColor: T.border }]}
                activeOpacity={0.7}
              >
                <Text style={[styles.linkedName, { color: T.textBright }]}>{res.name}</Text>
                <Text style={[styles.linkedType, { color: T.textDim }]}>{res.type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {event.tags.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>TAGS</Text>
            <View style={styles.tagsRow}>
              {event.tags.map((tag) => (
                <View key={tag.id} style={[styles.tag, { backgroundColor: tag.color + "22" }]}>
                  <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <TouchableOpacity
            style={styles.activityToggle}
            onPress={() => setActivityOpen((v) => !v)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={activityOpen ? "Hide activity" : "Show activity"}
          >
            {activityOpen ? (
              <CaretDown size={12} color={T.textDim} weight="bold" />
            ) : (
              <CaretRight size={12} color={T.textDim} weight="bold" />
            )}
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>ACTIVITY</Text>
          </TouchableOpacity>
          <EventActivityList eventId={masterId} enabled={activityOpen} />
        </View>
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={event.title}
        subtitle={event.isAllDay ? allDayLabel : `${event.startTimeFormatted} · ${event.duration}`}
        icon="calendar"
        iconColor={eventColor}
        actions={[
          ...(canEdit
            ? [
                {
                  icon: "edit-2" as const,
                  label: "Edit event",
                  onPress: () => (needsScope ? setScopeAction("edit") : editEvent()),
                },
              ]
            : []),
          {
            icon: "at-sign",
            label: "Copy reference link",
            onPress: () => void copyReferenceLink(),
          },
          ...(canEdit
            ? [
                {
                  icon: "user-plus" as const,
                  label: "Invite more people",
                  onPress: () => setInvitePickerOpen(true),
                },
              ]
            : []),
          ...(hasMeetingUrl
            ? [
                {
                  icon: "video" as const,
                  label: "Join video call",
                  color: "#40C057",
                  onPress: () => Linking.openURL(event.meetingUrl!),
                },
              ]
            : []),
          ...(hasChannel
            ? [
                {
                  icon: "video" as const,
                  label: activeMeetingCall ? "Join live meeting" : "Join meeting",
                  color: "#40C057",
                  onPress: () => {
                    setSheetOpen(false);
                    openMeetingPrejoin();
                  },
                },
              ]
            : []),
          {
            icon: "edit-3",
            label: "Create meeting notes",
            color: T.accent,
            onPress: () =>
              router.push({
                pathname: "/notes/edit",
                params: {
                  initialTitle: `${event.title} - meeting notes`,
                  // Canonical mention form, which the editor parses back into a
                  // chip: the note stays linked to the event rather than merely
                  // repeating its name.
                  initialContent: `[[[${event.title}|${eventUrn}]]]\n${dateLabel} · ${event.startTimeFormatted}\n\n`,
                },
              }),
          },
          {
            icon: "star",
            label: bookmarked ? "Remove from favorites" : "Add to favorites",
            color: bookmarked ? T.accent : undefined,
            onPress: () => toggleBookmark.mutate(eventUrn),
          },
          ...(canEdit
            ? [
                {
                  icon: "copy" as const,
                  label: "Save as template",
                  onPress: () =>
                    createTemplate.mutate(
                      {
                        title: event.title,
                        description: event.description || undefined,
                        durationMinutes: Math.max(
                          5,
                          Math.round(
                            (new Date(event.endTime).getTime() -
                              new Date(event.startTime).getTime()) /
                              60000,
                          ),
                        ),
                        location: event.location || undefined,
                        meetingUrl: event.meetingUrl || undefined,
                        categoryId: event.categoryId || undefined,
                      },
                      {
                        onSuccess: () =>
                          Alert.alert("Template saved", "New events can now start from it."),
                        onError: (error) =>
                          Alert.alert(
                            "Could not save template",
                            userFacingError(error, "The template was not saved."),
                          ),
                      },
                    ),
                },
              ]
            : []),
          ...(canDelete
            ? [
                {
                  icon: "trash-2" as const,
                  label: "Delete event",
                  isDanger: true,
                  onPress: () => (needsScope ? setScopeAction("delete") : removeEvent()),
                },
              ]
            : []),
        ]}
      />

      <RecurrenceScopeSheet
        visible={scopeAction !== null}
        action={scopeAction ?? "edit"}
        accentColor={eventColor}
        busy={deleteEvent.isPending}
        onClose={() => setScopeAction(null)}
        onSelect={(scope) => {
          const pending = scopeAction;
          setScopeAction(null);
          if (pending === "delete") removeEvent(scope);
          else editEvent(scope);
        }}
      />

      <SubjectPickerSheet
        visible={invitePickerOpen}
        onClose={() => setInvitePickerOpen(false)}
        title="Invite people"
        accentColor={eventColor}
        selectedIds={attendeeIds}
        busy={addAttendees.isPending || removeAttendees.isPending}
        onToggle={(userId) => toggleAttendee(userId, attendeeIds.includes(userId))}
      />

      <BottomSheet visible={reminderSheetOpen} onClose={() => setReminderSheetOpen(false)}>
        <SheetHeader
          title="Reminders"
          accentColor={eventColor}
          busy={updateEvent.isPending}
          actions={[{ label: "Save", onPress: saveReminders, disabled: updateEvent.isPending }]}
        />
        <View style={styles.reminderSheetBody}>
          <ReminderChips
            value={draftReminders}
            onChange={setDraftReminders}
            lockLast={event.reminders.length > 0}
          />
          {event.reminders.length > 0 ? (
            <Text style={[styles.reminderHint, { color: T.textDim }]}>
              An event that has reminders keeps at least one.
            </Text>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOverlay: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  scrollContent: { padding: 20, gap: 20 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 60 },
  titleSection: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  colorBar: { width: 4, borderRadius: 2, minHeight: 40, marginTop: 4 },
  title: { fontSize: 22, fontFamily: FONT.bold, lineHeight: 30, flex: 1 },
  recurringBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  recurringText: { fontSize: 11, fontFamily: FONT.regular },
  infoCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  infoIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  infoMain: { fontSize: 14, fontFamily: FONT.semibold },
  infoSub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  infoDivider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  attendeeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  attendeeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  attendeeInitial: { fontSize: 12, fontFamily: FONT.semibold },
  attendeeName: { fontSize: 14, fontFamily: FONT.medium, flex: 1 },
  rsvpBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  rsvpText: { fontSize: 11, fontFamily: FONT.medium },
  rsvpRow: { flexDirection: "row", gap: 8 },
  rsvpOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  rsvpOptionText: { fontSize: 13, fontFamily: FONT.semibold },
  linkedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkedName: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  linkedType: { fontSize: 11, fontFamily: FONT.regular, textTransform: "uppercase" },
  tagsSection: { gap: 10 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tagText: { fontSize: 12, fontFamily: FONT.medium },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  categoryBadgeDot: { width: 8, height: 8, borderRadius: 4 },
  categoryBadgeText: { fontSize: 13, fontFamily: FONT.semibold },
  struckTitle: { textDecorationLine: "line-through", opacity: 0.7 },
  stateBadgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stateBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  stateBadgeText: { fontSize: 12, fontFamily: FONT.medium },
  roomCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  roomHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  roomName: { fontSize: 14, fontFamily: FONT.semibold },
  roomMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingLeft: 24 },
  roomMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  roomMetaText: { fontSize: 12, fontFamily: FONT.regular },
  roomAmenities: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingLeft: 24 },
  amenityChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  amenityText: { fontSize: 11, fontFamily: FONT.medium },
  activityToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  reminderSheetBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  reminderHint: { fontSize: 12, fontFamily: FONT.regular },
});
