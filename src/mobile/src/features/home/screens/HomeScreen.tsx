import React, { useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { NotePencil, CalendarBlank, Kanban, Books, BellSimple, Hash } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@core/providers/AuthContext";
import { useTheme } from "@shared/hooks/useTheme";
import { parseCalendarDate } from "@shared/lib/dateFormatting";
import { zonedDayKey } from "@shared/lib/zonedTime";
import { useEventsInRange } from "@features/calendar/useCalendar";
import { eventDisplayState } from "@features/calendar/eventDisplay";
import type { SerializedEvent } from "@features/calendar/calendarSerializer";
import { useNotesList } from "@features/notes/useNotes";
import { useProjectsList } from "@features/projects/useProjects";
import { useChannels } from "@features/chat/useChat";
import { useUnreadNotificationCount } from "@features/notifications/useNotifications";
import { Avatar } from "@shared/components/Avatar";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";

// Text is set on a heading's tight leading rather than the roomy default the
// font picks for body copy, so a two-line row stays under fifty points and the
// greeting reads as one sentence. Scaled by hand, because a lineHeight in a
// stylesheet is the one thing the reader's text-size setting never touches.
const LINES = { greeting: 18, name: 28, title: 18, meta: 15, weekday: 11 } as const;

const ROW_PAD_X = 12;
const ROW_GAP = 10;
// A row's leading column: a day stamp on events, a glyph everywhere else. The
// hairline between two rows starts where the text does.
const DAY_COL = 36;
const GLYPH_COL = 22;
const DAY_INSET = ROW_PAD_X + DAY_COL + ROW_GAP;
const GLYPH_INSET = ROW_PAD_X + GLYPH_COL + ROW_GAP;
const TODAY_BADGE = 20;

interface UpcomingRow {
  event: SerializedEvent;
  /** Set on the first event of a calendar day; the rows after it share the stamp. */
  stamp?: { weekday: string; day: number; today: boolean };
}

export function HomeScreen() {
  const { user } = useAuth();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const topPad = (Platform.OS === "web" ? 8 : insets.top) + 2;
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

  const upcoming = useMemo<UpcomingRow[]>(() => {
    const now = new Date();
    const todayKey = zonedDayKey(now);
    // "Upcoming" reads literally: what is still ahead, so this morning's
    // finished stand-up does not head the list all afternoon.
    const ahead = (eventsQuery.data ?? [])
      .filter((event) => new Date(event.endTime || event.startTime) >= now)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .slice(0, 5);
    const rows: UpcomingRow[] = [];
    let lastDayKey = "";
    for (const event of ahead) {
      const dayKey = zonedDayKey(event.startTime);
      if (dayKey === lastDayKey) {
        rows.push({ event });
        continue;
      }
      lastDayKey = dayKey;
      const day = parseCalendarDate(dayKey);
      rows.push({
        event,
        stamp: {
          weekday: day.toLocaleDateString(undefined, { weekday: "short" }),
          day: day.getDate(),
          today: dayKey === todayKey,
        },
      });
    }
    return rows;
  }, [eventsQuery.data]);

  const notes = notesQuery.data?.slice(0, 5) ?? [];
  const projects = projectsQuery.data?.slice(0, 4) ?? [];
  const unreadChannels = channels.filter((c) => c.unreadCount > 0).slice(0, 4);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const userName = user?.fullName || user?.username || "there";
  const { fontScale } = useWindowDimensions();
  const greetingLine = Math.round(LINES.greeting * fontScale);
  const nameLine = Math.round(LINES.name * fontScale);
  const titleLine = Math.round(LINES.title * fontScale);
  const metaLine = Math.round(LINES.meta * fontScale);
  const weekdayLine = Math.round(LINES.weekday * fontScale);

  const titleStyle = [styles.rowTitle, { color: T.textBright, lineHeight: titleLine }];
  const metaStyle = [styles.rowMeta, { color: T.textDim, lineHeight: metaLine }];

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: T.bg, paddingTop: topPad, borderBottomColor: T.border },
        ]}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.wordmark, { color: T.textBright }]}>uniffy</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: T.surfaceHover, borderColor: T.border }]}
              onPress={() => router.push("/library" as any)}
              activeOpacity={0.7}
              accessibilityLabel="Library"
            >
              <Books size={16} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: T.surfaceHover, borderColor: T.border }]}
              onPress={() => router.push("/notifications" as any)}
              activeOpacity={0.7}
              accessibilityLabel="Notifications"
            >
              <BellSimple size={16} color={T.text} weight="bold" />
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
                size={30}
                accentColor={T.accent}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: bottomPad }}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.greetingBlock}>
          <Text style={[styles.greeting, { color: T.textBright, lineHeight: greetingLine }]}>
            {greeting},
          </Text>
          <Text
            style={[styles.greetingName, { color: T.accent, lineHeight: nameLine }]}
            numberOfLines={1}
          >
            {userName}
          </Text>
        </View>

        {unreadChannels.length > 0 && (
          <View style={styles.section}>
            <SectionHeader label="UNREAD CHATS" onSeeAll={() => router.push("/chat" as any)} />
            <Group>
              {unreadChannels.map((channel, i) => (
                <React.Fragment key={channel.id}>
                  {i > 0 && <Separator inset={GLYPH_INSET} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => router.push(`/chat/${channel.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.glyphColumn}>
                      <Hash size={16} color={T.accent} weight="bold" />
                    </View>
                    <Text style={[titleStyle, styles.rowBody]} numberOfLines={1}>
                      {channel.name}
                    </Text>
                    <View
                      style={[
                        styles.chatBadge,
                        { backgroundColor: channel.mentionCount > 0 ? T.red : T.accent },
                      ]}
                    >
                      <Text style={styles.chatBadgeText}>
                        {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </Group>
          </View>
        )}

        <View style={styles.section}>
          <SectionHeader label="UPCOMING EVENTS" onSeeAll={() => router.push("/calendar" as any)} />
          <Group>
            {eventsQuery.isLoading ? (
              <LoadingRow />
            ) : upcoming.length === 0 ? (
              <EmptyRow
                icon={<CalendarBlank size={18} color={T.textDim} weight="duotone" />}
                text="No upcoming events this week"
              />
            ) : (
              upcoming.map(({ event, stamp }, i) => {
                // A private event arrives with its fields stripped, so the title
                // comes from the shared projection the calendar surfaces use.
                const display = eventDisplayState(event);
                const meta = [
                  event.isAllDay ? "All day" : event.startTimeFormatted,
                  !event.isAllDay && event.duration,
                  event.location,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <React.Fragment key={`${event.id}:${event.startTime}`}>
                    {i > 0 && <Separator inset={stamp ? 0 : DAY_INSET} />}
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => router.push(`/calendar/${event.id}` as any)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.dayColumn}>
                        {stamp && (
                          <>
                            <Text
                              style={[
                                styles.dayWeekday,
                                {
                                  color: stamp.today ? T.accent : T.textBright,
                                  lineHeight: weekdayLine,
                                },
                              ]}
                            >
                              {stamp.weekday.toUpperCase()}
                            </Text>
                            <View
                              style={[
                                styles.dayBadge,
                                stamp.today && { backgroundColor: T.accent },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.dayNumber,
                                  { color: stamp.today ? "#ffffff" : T.textBright },
                                ]}
                              >
                                {stamp.day}
                              </Text>
                            </View>
                          </>
                        )}
                      </View>
                      {/* Only the event fades when it is tentative or cancelled; the day it sits on is neither. */}
                      <View
                        style={[
                          styles.rowBody,
                          (display.cancelled || display.tentative) && styles.faded,
                        ]}
                      >
                        <Text
                          style={[titleStyle, display.cancelled && styles.struck]}
                          numberOfLines={1}
                        >
                          {display.title}
                        </Text>
                        {meta ? (
                          <Text style={metaStyle} numberOfLines={1}>
                            {meta}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })
            )}
          </Group>
        </View>

        <View style={styles.section}>
          <SectionHeader label="RECENT NOTES" onSeeAll={() => router.push("/notes" as any)} />
          <Group>
            {notesQuery.isLoading ? (
              <LoadingRow />
            ) : notes.length === 0 ? (
              <EmptyRow
                icon={<NotePencil size={18} color={T.textDim} weight="duotone" />}
                text="No notes yet"
              />
            ) : (
              notes.map((note, i) => (
                <React.Fragment key={note.id}>
                  {i > 0 && <Separator inset={GLYPH_INSET} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => router.push(`/notes/${note.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.glyphColumn}>
                      {note.icon?.type === "emoji" ? (
                        <Text style={styles.noteEmoji}>{note.icon.value}</Text>
                      ) : (
                        <NotePencil size={16} color={T.accent} weight="duotone" />
                      )}
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={titleStyle} numberOfLines={1}>
                        {note.title || "Untitled"}
                      </Text>
                      {note.snippet ? (
                        <Text style={metaStyle} numberOfLines={1}>
                          {note.snippet}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.rowTrailing, { color: T.textDim }]}>{note.editedAt}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))
            )}
          </Group>
        </View>

        <View style={styles.section}>
          <SectionHeader label="PROJECTS" onSeeAll={() => router.push("/projects" as any)} />
          <Group>
            {projectsQuery.isLoading ? (
              <LoadingRow />
            ) : projects.length === 0 ? (
              <EmptyRow
                icon={<Kanban size={18} color={T.textDim} weight="duotone" />}
                text="No projects yet"
              />
            ) : (
              projects.map((project, i) => (
                <React.Fragment key={project.id}>
                  {i > 0 && <Separator inset={GLYPH_INSET} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => router.push(`/projects/${project.id}` as any)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.glyphColumn}>
                      <Kanban size={16} color={project.color || T.accent} weight="duotone" />
                    </View>
                    <Text style={[titleStyle, styles.rowBody]} numberOfLines={1}>
                      {project.name}
                    </Text>
                    <Text style={[styles.rowTrailing, { color: T.textDim }]}>
                      {project.completedTaskCount}/{project.taskCount}{" "}
                      {project.taskCount === 1 ? "task" : "tasks"}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))
            )}
          </Group>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionHeader({ label, onSeeAll }: { label: string; onSeeAll: () => void }) {
  const T = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionLabel, { color: T.textBright }]}>{label}</Text>
      <TouchableOpacity onPress={onSeeAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={[styles.seeAllText, { color: T.accent }]}>See all</Text>
      </TouchableOpacity>
    </View>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return (
    <View style={[styles.group, { backgroundColor: T.surface, borderColor: T.border }]}>
      {children}
    </View>
  );
}

/** The hairline between two rows; a zero inset runs it edge to edge to close a day. */
function Separator({ inset }: { inset: number }) {
  const T = useTheme();
  return <View style={[styles.separator, { backgroundColor: T.border, marginLeft: inset }]} />;
}

function LoadingRow() {
  const T = useTheme();
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator size="small" color={T.accent} />
    </View>
  );
}

function EmptyRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  const T = useTheme();
  return (
    <View style={styles.emptyRow}>
      {icon}
      <Text style={[styles.emptyText, { color: T.textDim }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  greetingBlock: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  greeting: {
    fontSize: 14,
    fontFamily: FONT.medium,
  },
  greetingName: {
    fontSize: 22,
    fontFamily: FONT.bold,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  wordmark: {
    fontSize: 18,
    fontFamily: FONT.bold,
    letterSpacing: -0.5,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // The row's height is the buttons', so this size is what the header bar
  // costs beyond its padding.
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
    paddingTop: 16,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  group: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  separator: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: ROW_GAP,
    paddingHorizontal: ROW_PAD_X,
    paddingVertical: 8,
  },
  faded: { opacity: 0.65 },
  dayColumn: {
    width: DAY_COL,
    alignItems: "center",
    gap: 1,
  },
  dayWeekday: {
    fontSize: 9,
    fontFamily: FONT.semibold,
    letterSpacing: 0.6,
  },
  dayBadge: {
    width: TODAY_BADGE,
    height: TODAY_BADGE,
    borderRadius: TODAY_BADGE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNumber: {
    fontSize: 12,
    fontFamily: FONT.bold,
  },
  glyphColumn: {
    width: GLYPH_COL,
    alignItems: "center",
  },
  noteEmoji: { fontSize: 15 },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: 14,
    fontFamily: FONT.semibold,
  },
  rowMeta: {
    fontSize: 12,
    fontFamily: FONT.regular,
  },
  rowTrailing: {
    fontSize: 11,
    fontFamily: FONT.regular,
  },
  struck: { textDecorationLine: "line-through" },
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
  loadingRow: {
    paddingVertical: 14,
    alignItems: "center",
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: ROW_PAD_X,
    paddingVertical: 12,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: FONT.regular,
  },
});
