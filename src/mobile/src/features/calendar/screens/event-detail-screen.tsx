import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import {
  PencilSimple,
  DotsThree,
  Clock,
  MapPin,
  Video,
  ArrowsClockwise,
} from "phosphor-react-native";
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
import { useEvent, useCategories } from "@features/calendar/useCalendar";
import { useDeleteEvent } from "@features/calendar/useCalendarMutations";
import { useAuth } from "@core/providers/auth-context";
import { PreJoinSheet } from "@features/calls/components/PreJoinSheet";
import { useActiveCall } from "@features/calls/useCallsState";

const RSVP_COLORS: Record<string, string> = {
  accepted: "#40C057",
  tentative: "#FAB005",
  pending: "#909296",
  declined: "#E64980",
};

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const auth = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [prejoinOpen, setPrejoinOpen] = useState(false);
  const eventQuery = useEvent(id);
  const categoriesQuery = useCategories();
  const deleteEvent = useDeleteEvent();
  const activeMeetingCall = useActiveCall(eventQuery.data?.channelId ?? undefined);

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

  const hasMeetingUrl = !!event.meetingUrl;
  const hasChannel = !!event.channelId;
  const isRecurring = !!event.recurrence;
  const recurrenceLabel = event.recurrence ? `Recurring ${event.recurrence.pattern}` : "";

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
              onPress={() =>
                router.push({ pathname: "/calendar/create", params: { eventId: event.id } })
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <PencilSimple size={18} color={T.text} weight="duotone" />
            </TouchableOpacity>
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
                {event.dateFormatted} · {event.duration}
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
            onPress: () =>
              router.push({ pathname: "/calendar/create", params: { eventId: event.id } }),
          },
          { icon: "at-sign", label: "Copy reference link", onPress: () => {} },
          { icon: "user-plus", label: "Invite more people", onPress: () => {} },
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
            onPress: () => router.push("/notes/edit" as any),
          },
          { icon: "star", label: "Add to favorites", onPress: () => {} },
          {
            icon: "trash-2" as const,
            label: "Delete event",
            isDanger: true,
            onPress: () => {
              deleteEvent.mutate(event.id);
              setSheetOpen(false);
              router.back();
            },
          },
        ]}
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
