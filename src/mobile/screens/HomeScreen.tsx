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
import { NotePencil, CalendarBlank, Kanban, CaretRight } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/hooks/useTheme";
import { useEventsInRange } from "@/hooks/useCalendar";
import { useNotesList } from "@/hooks/useNotes";
import { useProjectsList } from "@/hooks/useProjects";
import { DOMAIN_COLORS, BOTTOM_NAV_HEIGHT } from "@/constants/theme";

export function HomeScreen() {
  const { user } = useAuth();
  const T = useTheme();
  const insets = useSafeAreaInsets();
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

  const events = eventsQuery.data?.slice(0, 5) ?? [];
  const notes = notesQuery.data?.slice(0, 5) ?? [];
  const projects = projectsQuery.data?.slice(0, 4) ?? [];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const userName = user?.fullName || user?.username || "there";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: T.pageBg }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { backgroundColor: T.bg }]}>
        <Text style={[styles.greeting, { color: T.textBright }]}>
          {greeting}, <Text style={[styles.greetingName, { color: T.accent }]}>{userName}</Text>
        </Text>
      </View>

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
            <ActivityIndicator size="small" color={DOMAIN_COLORS.calendar} />
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
                style={[
                  styles.eventCard,
                  {
                    backgroundColor: T.surface,
                    borderColor: T.border,
                    borderLeftColor: DOMAIN_COLORS.calendar,
                  },
                ]}
                onPress={() => router.push(`/calendar/${event.id}` as any)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventTitle, { color: T.textBright }]}>{event.title}</Text>
                  {metaParts.length > 0 && (
                    <Text style={[styles.eventMeta, { color: T.textDim }]}>
                      {metaParts.join(" · ")}
                    </Text>
                  )}
                </View>
                <Text style={[styles.eventTime, { color: DOMAIN_COLORS.calendar }]}>
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
            <ActivityIndicator size="small" color={DOMAIN_COLORS.notes} />
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
              <View style={[styles.noteIcon, { backgroundColor: DOMAIN_COLORS.notesSoft }]}>
                {note.icon?.type === "emoji" ? (
                  <Text style={styles.noteEmoji}>{note.icon.value}</Text>
                ) : (
                  <NotePencil size={16} color={DOMAIN_COLORS.notes} weight="duotone" />
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
            <ActivityIndicator size="small" color={DOMAIN_COLORS.projects} />
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
                  styles.projectDot,
                  { backgroundColor: project.color || DOMAIN_COLORS.projects },
                ]}
              />
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
    paddingTop: 16,
    paddingBottom: 14,
  },
  greeting: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
  },
  greetingName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  seeAllText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
    fontFamily: "Inter_400Regular",
  },
  eventCard: {
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    gap: 12,
  },
  eventTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  eventMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  eventTime: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
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
    fontFamily: "Inter_500Medium",
  },
  noteSnippet: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  noteTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  projectCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projectDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  projectName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  projectMeta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
});
