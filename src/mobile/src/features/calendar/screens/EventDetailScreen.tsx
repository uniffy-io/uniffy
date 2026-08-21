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
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { DotsThree, Clock, MapPin, Video, ArrowsClockwise } from "phosphor-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { RecurrenceEditScope } from "@uniffy/proto/cal/v1/calendar_pb";
import { RecurrenceScopeSheet } from "@features/calendar/components/RecurrenceScopeSheet";
import { useEvent, useCategories } from "@features/calendar/useCalendar";
import { formatCalendarDate } from "@features/calendar/calendarSerializer";
import {
  useAddAttendees,
  useDeleteEvent,
  useRemoveAttendees,
} from "@features/calendar/useCalendarMutations";
import { useIsBookmarked, useToggleBookmark } from "@features/bookmarks/useBookmarks";
import { PreJoinSheet } from "@features/calls/components/PreJoinSheet";
import { useActiveCall } from "@features/calls/useCallsState";

const RSVP_COLORS: Record<string, string> = {
  accepted: "#40C057",
  tentative: "#FAB005",
  pending: "#909296",
  declined: "#E64980",
};

// An occurrence of a recurring event is addressed as
// `{masterId}__occurrence__{date}` - a virtual id the calendar domain expands
// from the one row that actually exists. Anything naming the event AS CONTENT
// (its URN, a bookmark, a mention pasted into a note) has to name that row, or
// it points at a key nothing will ever resolve.
const OCCURRENCE_SEPARATOR = "__occurrence__";

export function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const [invitePickerOpen, setInvitePickerOpen] = useState(false);
  const [scopeAction, setScopeAction] = useState<"edit" | "delete" | null>(null);
  const eventQuery = useEvent(id);
  const categoriesQuery = useCategories();
  const deleteEvent = useDeleteEvent();
  const addAttendees = useAddAttendees();
  const removeAttendees = useRemoveAttendees();
  const activeMeetingCall = useActiveCall(eventQuery.data?.channelId ?? undefined);

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
      if (isAttendee) removeAttendees.mutate(args);
      else addAttendees.mutate(args);
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

  const hasMeetingUrl = !!event.meetingUrl;
  const hasChannel = !!event.channelId;
  const isRecurring = !!event.recurrence;
  const recurrenceLabel = event.recurrence ? `Recurring ${event.recurrence.pattern}` : "";

  // Only an expanded occurrence can be narrowed - it is the one that knows
  // which date it stands for. Acting on the series row itself has no "this
  // one" to mean, so it keeps going straight through.
  const needsScope = isRecurring && !!occurrenceDate;

  // The series row carries the date the recurrence STARTED, so an occurrence
  // opened from any later day would otherwise be labelled with the first one -
  // and "This event" in the scope sheet would name a day that is not on screen.
  const dateLabel = occurrenceDate ? formatCalendarDate(occurrenceDate) : event.dateFormatted;

  const editEvent = (scope?: RecurrenceEditScope) =>
    router.push({
      pathname: "/calendar/create",
      params: {
        eventId: id,
        ...(scope !== undefined && occurrenceDate
          ? { recurrenceEditScope: String(scope), occurrenceDate }
          : {}),
      },
    });

  const removeEvent = (scope?: RecurrenceEditScope) => {
    deleteEvent.mutate({
      eventId: id,
      recurrenceEditScope: scope,
      occurrenceDate: scope === undefined ? undefined : occurrenceDate,
    });
    router.back();
  };

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="Calendar"
        color={T.accent}
        icon="calendar"
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

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleSection}>
          <View style={[styles.colorBar, { backgroundColor: eventColor }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: T.textBright }]}>{event.title}</Text>
            {isRecurring && (
              <View
                style={[
                  styles.recurringBadge,
                  { backgroundColor: T.surface, borderColor: T.border },
                ]}
              >
                <ArrowsClockwise size={10} color={T.textDim} weight="duotone" />
                <Text style={[styles.recurringText, { color: T.textDim }]}>{recurrenceLabel}</Text>
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

        <View style={[styles.infoCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIcon, { backgroundColor: eventColor + "20" }]}>
              <Clock size={14} color={eventColor} weight="duotone" />
            </View>
            <View>
              <Text style={[styles.infoMain, { color: T.textBright }]}>
                {event.startTimeFormatted} – {event.endTimeFormatted}
              </Text>
              <Text style={[styles.infoSub, { color: T.textDim }]}>
                {dateLabel} · {event.duration}
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
                <TouchableOpacity onPress={() => setPrejoinOpen(true)}>
                  <Text
                    style={[styles.infoMain, { color: activeMeetingCall ? "#F43F5E" : T.accent }]}
                  >
                    {activeMeetingCall ? "Join live meeting" : "Join meeting"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

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
                <View key={tag} style={[styles.tag, { backgroundColor: T.accentSoft }]}>
                  <Text style={[styles.tagText, { color: T.accent }]}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={event.title}
        subtitle={`${event.startTimeFormatted} · ${event.duration}`}
        icon="calendar"
        iconColor={eventColor}
        actions={[
          {
            icon: "edit-2",
            label: "Edit event",
            onPress: () => (needsScope ? setScopeAction("edit") : editEvent()),
          },
          {
            icon: "at-sign",
            label: "Copy reference link",
            onPress: () => void copyReferenceLink(),
          },
          {
            icon: "user-plus",
            label: "Invite more people",
            onPress: () => setInvitePickerOpen(true),
          },
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
                    setPrejoinOpen(true);
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
          {
            icon: "trash-2" as const,
            label: "Delete event",
            isDanger: true,
            onPress: () => (needsScope ? setScopeAction("delete") : removeEvent()),
          },
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

      {event.channelId ? (
        <PreJoinSheet
          visible={prejoinOpen}
          T={T}
          channelId={event.channelId}
          channelName={event.title}
          callId={activeMeetingCall?.id}
          onClose={() => setPrejoinOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
});
