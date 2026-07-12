import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  NotePencil,
  CalendarBlank,
  Kanban,
  CaretRight,
  BookmarkSimple,
  BellSimple,
  Hash,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/hooks/useTheme";
import { useEventsInRange } from "@/hooks/useCalendar";
import { useNotesList } from "@/hooks/useNotes";
import { useProjectsList } from "@/hooks/useProjects";
import { useChannels } from "@/hooks/useChat";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { Avatar } from "@/components/Avatar";
import { BOTTOM_NAV_HEIGHT } from "@/constants/theme";
import { FONT } from "@/constants/typography";

export function HomeScreen() {
  const { user } = useAuth();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 8 : insets.top) + 4;
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const { startIso, endIso } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return { startIso: now.toISOString(), endIso: end.toISOString() };
  }, []);

  const eventsQuery = useEventsInRange(startIso, endIso);
  const notesQuery = useNotesList("Recent");
  const projectsQuery = useProjectsList();
  const { channels } = useChannels();
  const unreadNotifications = useUnreadNotificationCount().data ?? 0;

  const events = eventsQuery.data?.slice(0, 5) ?? [];
  const notes = notesQuery.data?.slice(0, 5) ?? [];
  const projects = projectsQuery.data?.slice(0, 4) ?? [];
  const unreadChannels = channels.filter((c) => c.unreadCount > 0).slice(0, 4);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const userName = user?.fullName || user?.username || "there";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: T.pageBg }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { backgroundColor: T.bg, paddingTop: topPad }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.wordmark, { color: T.textBright }]}>uniffy</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: T.surfaceHover, borderColor: T.border }]}
              onPress={() => router.push("/bookmarks" as any)}
              activeOpacity={0.7}
              accessibilityLabel="Bookmarks"
            >
              <BookmarkSimple size={18} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: T.surfaceHover, borderColor: T.border }]}
              onPress={() => router.push("/notifications" as any)}
              activeOpacity={0.7}
              accessibilityLabel="Notifications"
            >
              <BellSimple size={18} color={T.text} weight="bold" />
              {unreadNotifications > 0 && (
                <View style={[styles.actionBadge, { backgroundColor: T.red, borderColor: T.bg }]}>
                  <Text style={styles.actionBadgeText}>
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/you" as any)}
              activeOpacity={0.7}
              accessibilityLabel="Profile and settings"
            >
              <Avatar
                name={user?.fullName || user?.username || "?"}
                avatarUrl={user?.avatarUrl}
                size={34}
                accentColor={T.accent}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.greetingBlock}>
        <Text style={[styles.greeting, { color: T.textBright }]}>{greeting},</Text>
        <Text style={[styles.greetingName, { color: T.accent }]} numberOfLines={1}>
          {userName}
        </Text>
      </View>

      {unreadChannels.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>UNREAD CHATS</Text>
            <TouchableOpacity
              onPress={() => router.push("/chat" as any)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.seeAllText, { color: T.accent }]}>See all</Text>
            </TouchableOpacity>
          </View>
          {unreadChannels.map((channel) => (
            <TouchableOpacity
              key={channel.id}
              style={[styles.chatRow, { backgroundColor: T.surface, borderColor: T.border }]}
              onPress={() => router.push(`/chat/${channel.id}` as any)}
              activeOpacity={0.8}
            >
              <View style={[styles.chatIcon, { backgroundColor: T.domains.chatSoft }]}>
                <Hash size={16} color={T.domains.chat} weight="bold" />
              </View>
              <Text style={[styles.chatName, { color: T.textBright }]} numberOfLines={1}>
                {channel.name}
              </Text>
              <View
                style={[
                  styles.chatBadge,
                  {
                    backgroundColor: channel.mentionCount > 0 ? T.red : T.domains.chat,
                  },
                ]}
              >
                <Text style={styles.chatBadgeText}>
                  {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Upcoming Events */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>UPCOMING</Text>
          <TouchableOpacity
            onPress={() => router.push("/calendar" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.seeAllText, { color: T.accent }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {eventsQuery.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={T.domains.calendar} />
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyState}>
            <CalendarBlank size={24} color={T.textDim} weight="duotone" />
            <Text style={[styles.emptyText, { color: T.textDim }]}>
              No upcoming events this week
            </Text>
          </View>
        ) : (
          events.map((event) => {
            const metaParts = [event.startTimeFormatted, event.duration, event.location].filter(
              Boolean,
            );
            return (
              <TouchableOpacity
                key={event.id}
                style={[styles.eventCard, { backgroundColor: T.surface, borderColor: T.border }]}
                onPress={() => router.push(`/calendar/${event.id}` as any)}
                activeOpacity={0.8}
              >
                <View style={[styles.domainIcon, { backgroundColor: T.domains.calendarSoft }]}>
                  <CalendarBlank size={18} color={T.domains.calendar} weight="duotone" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventTitle, { color: T.textBright }]}>{event.title}</Text>
                  {metaParts.length > 0 && (
                    <Text style={[styles.eventMeta, { color: T.textDim }]}>
                      {metaParts.join(" · ")}
                    </Text>
                  )}
                </View>
                <Text style={[styles.eventTime, { color: T.domains.calendar }]}>
                  {event.dateFormatted?.split(", ")[0] ?? ""}
                </Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Recent Notes */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>RECENT NOTES</Text>
          <TouchableOpacity
            onPress={() => router.push("/notes" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.seeAllText, { color: T.accent }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {notesQuery.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={T.domains.notes} />
          </View>
        ) : notes.length === 0 ? (
          <View style={styles.emptyState}>
            <NotePencil size={24} color={T.textDim} weight="duotone" />
            <Text style={[styles.emptyText, { color: T.textDim }]}>No notes yet</Text>
          </View>
        ) : (
          notes.map((note) => (
            <TouchableOpacity
              key={note.id}
              style={[styles.noteRow, { borderBottomColor: T.border }]}
              onPress={() => router.push(`/notes/${note.id}` as any)}
              activeOpacity={0.8}
            >
              <View style={[styles.noteIcon, { backgroundColor: T.domains.notesSoft }]}>
                {note.icon?.type === "emoji" ? (
                  <Text style={styles.noteEmoji}>{note.icon.value}</Text>
                ) : (
                  <NotePencil size={16} color={T.domains.notes} weight="duotone" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.noteTitle, { color: T.textBright }]} numberOfLines={1}>
                  {note.title || "Untitled"}
                </Text>
                {note.snippet ? (
                  <Text style={[styles.noteSnippet, { color: T.textDim }]} numberOfLines={1}>
                    {note.snippet}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.noteTime, { color: T.textDim }]}>{note.editedAt}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Active Projects */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>PROJECTS</Text>
          <TouchableOpacity
            onPress={() => router.push("/projects" as any)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.seeAllText, { color: T.accent }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {projectsQuery.isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={T.domains.projects} />
          </View>
        ) : projects.length === 0 ? (
          <View style={styles.emptyState}>
            <Kanban size={24} color={T.textDim} weight="duotone" />
            <Text style={[styles.emptyText, { color: T.textDim }]}>No projects yet</Text>
          </View>
        ) : (
          projects.map((project) => (
            <TouchableOpacity
              key={project.id}
              style={[styles.projectCard, { backgroundColor: T.surface, borderColor: T.border }]}
              onPress={() => router.push(`/projects/${project.id}` as any)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.domainIcon,
                  { backgroundColor: project.color ? project.color + "22" : T.domains.projectsSoft },
                ]}
              >
                <Kanban
                  size={18}
                  color={project.color || T.domains.projects}
                  weight="duotone"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.projectName, { color: T.textBright }]}>{project.name}</Text>
                <Text style={[styles.projectMeta, { color: T.textDim }]}>
                  {project.memberIds.length} {project.memberIds.length === 1 ? "member" : "members"}
                </Text>
              </View>
              <CaretRight size={14} color={T.textDim} weight="regular" />
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  greetingBlock: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 2,
  },
  greeting: {
    fontSize: 22,
    fontFamily: FONT.semibold,
  },
  greetingName: {
    fontSize: 26,
    fontFamily: FONT.bold,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: {
    fontSize: 20,
    fontFamily: FONT.bold,
    letterSpacing: -0.5,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBadge: {
    position: "absolute",
    top: -4,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  actionBadgeText: {
    fontSize: 8,
    fontFamily: FONT.bold,
    color: "#ffffff",
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT.semibold,
    letterSpacing: 0.8,
  },
  seeAllText: {
    fontSize: 12,
    fontFamily: FONT.medium,
  },
  loadingRow: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptyState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 16,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: FONT.regular,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chatIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  chatName: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT.semibold,
  },
  chatBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  chatBadgeText: {
    fontSize: 10,
    fontFamily: FONT.bold,
    color: "#ffffff",
  },
  eventCard: {
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  domainIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  eventTitle: {
    fontSize: 14,
    fontFamily: FONT.semibold,
  },
  eventMeta: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 2,
  },
  eventTime: {
    fontSize: 12,
    fontFamily: FONT.semibold,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  noteIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  noteEmoji: {
    fontSize: 18,
  },
  noteTitle: {
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  noteSnippet: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 2,
  },
  noteTime: {
    fontSize: 11,
    fontFamily: FONT.regular,
  },
  projectCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projectName: {
    fontSize: 14,
    fontFamily: FONT.semibold,
  },
  projectMeta: {
    fontSize: 12,
    fontFamily: FONT.regular,
    marginTop: 1,
  },
});
