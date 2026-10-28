import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import {
  CaretLeft,
  CaretRight,
  CheckSquareOffset,
  Clock,
  Lock,
  Plus,
  Trash,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DomainHeader } from "@shared/components/DomainHeader";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { LogTimeSheet } from "@features/projects/components/LogTimeSheet";
import { PeriodStatusCard } from "@features/projects/components/PeriodStatusCard";
import {
  WeekTaskPickerSheet,
  type PickedTask,
} from "@features/projects/components/WeekTaskPickerSheet";
import { formatMinutes } from "@features/projects/timeFormatting";
import { localDayKey, type SerializedWorklog } from "@features/projects/timeSerializer";
import {
  addDays,
  dayOfMonth,
  dayStatus,
  dayTotals,
  entriesByDay,
  formatDayLong,
  formatDayRange,
  normalizeWeekStart,
  offLabel,
  requirementsFor,
  weekDays,
  weekdayShort,
  weekStartOf,
  type DayStatus,
} from "@features/projects/timeWeek";
import { lockHint, sheetFor } from "@features/projects/timesheetStatus";
import { useMyWeek, useTimePolicy, useTimesheet } from "@features/projects/useMyTime";
import { useReviewInbox } from "@features/projects/useTimeReview";
import { useProjectTasks } from "@features/projects/useProjects";
import { useTaskLabels } from "@features/projects/useTaskLabels";
import {
  useCreateWorklog,
  useDeleteWorklog,
  useRecallTimesheet,
  useSubmitTimesheet,
  useUpdateWorklog,
} from "@features/projects/useTimeMutations";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
// One modal must finish dismissing before another can present on iOS.
const SHEET_SWAP_MS = 320;

type Sheet =
  | { kind: "pick" }
  | { kind: "log"; task: PickedTask }
  | { kind: "edit"; entry: SerializedWorklog }
  | null;

function requirementNote(required: number, off: boolean): string {
  const away = offLabel(required, off);
  if (away === "off") return "Day off";
  if (away === "half day") return `Half day, ${formatMinutes(required)} required`;
  return required > 0 ? `${formatMinutes(required)} required` : "No hours required";
}

/** The person's week: a day strip with totals and the chosen day's entries. */
export function MyTimeScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const today = localDayKey();
  const [anchor, setAnchor] = useState(today);
  const [selectedDay, setSelectedDay] = useState(today);
  const [sheet, setSheet] = useState<Sheet>(null);

  const policyQuery = useTimePolicy();
  const policy = policyQuery.data;
  const weekStart = normalizeWeekStart(policy?.weekStart);
  const days = useMemo(() => weekDays(weekStartOf(anchor, weekStart)), [anchor, weekStart]);
  const weekQuery = useMyWeek(days[0], days[6]);
  const worklogs = useMemo(() => weekQuery.data?.worklogs ?? [], [weekQuery.data]);
  const served = useMemo(() => weekQuery.data?.days ?? [], [weekQuery.data]);
  const internalTasksQuery = useProjectTasks(policy?.internalProjectId ?? undefined);
  const labels = useTaskLabels(worklogs.map((entry) => entry.taskId));

  const approvals = policy?.approvalsEnabled === true;
  const firstSheet = useTimesheet(days[0], approvals);
  // A monthly period can change inside the week; weekly periods share the week's bounds.
  const lastSheet = useTimesheet(days[6], approvals && policy?.periodType === "monthly");
  const sheets = useMemo(
    () => (approvals ? [firstSheet.data, lastSheet.data] : []),
    [approvals, firstSheet.data, lastSheet.data],
  );
  // One probe of the inbox decides whether this person reviews anyone.
  const inbox = useReviewInbox(today, { enabled: approvals });
  const reviewRows = inbox.data?.rows ?? [];
  const showApprovals =
    approvals && (reviewRows.length > 0 || inbox.data?.viewerIsTimekeepingAdmin === true);
  const waitingReviews = reviewRows.filter((row) => row.status === "submitted").length;
  const submitTimesheet = useSubmitTimesheet();
  const recallTimesheet = useRecallTimesheet();

  const createWorklog = useCreateWorklog();
  const updateWorklog = useUpdateWorklog();
  const deleteWorklog = useDeleteWorklog();

  const byDay = useMemo(() => entriesByDay(worklogs), [worklogs]);
  const totals = useMemo(() => dayTotals(worklogs, days), [worklogs, days]);
  const requirements = useMemo(() => requirementsFor(days, served), [days, served]);
  const weekTotal = days.reduce((sum, day) => sum + totals[day], 0);
  const weekRequired = days.reduce((sum, day) => sum + requirements[day].required, 0);
  const visibleDay = days.includes(selectedDay) ? selectedDay : days[0];
  const dayEntries = byDay[visibleDay] ?? [];
  const requirement = requirements[visibleDay];
  const isCurrentWeek = days.includes(today);
  const visibleSheet = sheetFor(sheets, visibleDay);
  const dayLock = lockHint(visibleSheet);

  const weekTasks = useMemo(() => {
    const seen = new Map<string, PickedTask>();
    for (const entry of worklogs) {
      if (seen.has(entry.taskId)) continue;
      const label = labels[entry.taskId];
      seen.set(entry.taskId, {
        id: entry.taskId,
        projectId: entry.projectId,
        title: label?.title ?? "Task",
        subtitle: label?.code ?? undefined,
      });
    }
    return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [worklogs, labels]);

  const internalTasks = useMemo(
    () =>
      (internalTasksQuery.data ?? [])
        .filter((task) => !task.completedAt)
        .sort((a, b) => a.number - b.number)
        .map((task) => ({
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          subtitle: `#${task.number}`,
        })),
    [internalTasksQuery.data],
  );

  const statusColor: Record<DayStatus, string> = {
    none: T.textDim,
    logged: T.text,
    under: T.yellow,
    met: T.green,
    over: T.green,
  };

  const move = (delta: number) => {
    setAnchor(addDays(days[0], delta));
    setSelectedDay(addDays(visibleDay, delta));
  };
  const goToday = () => {
    setAnchor(today);
    setSelectedDay(today);
  };

  const pickTask = (task: PickedTask) => {
    setSheet(null);
    setTimeout(() => setSheet({ kind: "log", task }), SHEET_SWAP_MS);
  };

  const removeEntry = (entry: SerializedWorklog) =>
    confirmDestructive({
      title: "Delete time entry",
      message: `Remove ${formatMinutes(entry.durationMinutes)} logged on ${formatDayLong(entry.workDate)}?`,
      onConfirm: () => deleteWorklog.mutate({ worklogId: entry.id, projectId: entry.projectId }),
    });

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;
  const editing = sheet?.kind === "edit" ? sheet.entry : null;
  const logging = sheet?.kind === "log" ? sheet.task : null;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title="My time"
        subtitle={formatDayRange(days[0], days[6])}
        color={T.accent}
        icon="projects"
        rightActions={
          <>
            <TouchableOpacity
              hitSlop={HIT_SLOP}
              onPress={() => move(-7)}
              accessibilityLabel="Previous week"
              testID="week-previous"
            >
              <CaretLeft size={20} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={HIT_SLOP}
              onPress={() => move(7)}
              accessibilityLabel="Next week"
              testID="week-next"
            >
              <CaretRight size={20} color={T.text} weight="bold" />
            </TouchableOpacity>
            {policy?.enabled !== false && (
              <TouchableOpacity
                hitSlop={HIT_SLOP}
                onPress={() => setSheet({ kind: "pick" })}
                accessibilityLabel="Log time"
                testID="week-add"
              >
                <Plus size={21} color={T.accent} weight="bold" />
              </TouchableOpacity>
            )}
          </>
        }
      />

      {policy && !policy.enabled ? (
        <View style={styles.centered}>
          <Clock size={40} color={T.textDim} weight="duotone" />
          <Text style={[styles.empty, { color: T.textDim }]}>
            Time tracking is turned off for this organization.
          </Text>
        </View>
      ) : weekQuery.isLoading && !weekQuery.data ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={weekQuery.isRefetching}
              onRefresh={() => void weekQuery.refetch()}
              tintColor={T.accent}
            />
          }
        >
          <View style={styles.totalRow}>
            <Text style={[styles.total, { color: T.textBright }]} testID="week-total">
              {formatMinutes(weekTotal)}
              {weekRequired > 0 && (
                <Text style={{ color: T.textDim }}> of {formatMinutes(weekRequired)}</Text>
              )}
            </Text>
            {!isCurrentWeek && (
              <TouchableOpacity onPress={goToday} hitSlop={HIT_SLOP} testID="week-today">
                <Text style={[styles.todayLink, { color: T.accent }]}>Today</Text>
              </TouchableOpacity>
            )}
          </View>

          {showApprovals && (
            <TouchableOpacity
              style={[styles.reviewLink, { backgroundColor: T.surface, borderColor: T.border }]}
              onPress={() => router.push("/projects/approvals" as any)}
              testID="my-time-approvals"
            >
              <CheckSquareOffset size={18} color={T.accent} />
              <Text style={[styles.reviewLabel, { color: T.textBright }]}>Approvals</Text>
              <Text style={[styles.reviewCount, { color: waitingReviews ? T.accent : T.textDim }]}>
                {inbox.hasNextPage
                  ? "View all"
                  : waitingReviews > 0
                    ? `${waitingReviews} waiting`
                    : "Nothing waiting"}
              </Text>
              <CaretRight size={14} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}

          {visibleSheet && (
            <PeriodStatusCard
              sheet={visibleSheet}
              busy={submitTimesheet.isPending || recallTimesheet.isPending}
              onSubmit={(comment, reviewerUserId) =>
                submitTimesheet.mutate({ day: visibleSheet.periodStart, comment, reviewerUserId })
              }
              onRecall={() => recallTimesheet.mutate({ day: visibleSheet.periodStart })}
            />
          )}

          <View style={[styles.strip, { backgroundColor: T.surface, borderColor: T.border }]}>
            {days.map((day) => {
              const { required, off } = requirements[day];
              const status = dayStatus(totals[day], required);
              const selected = day === visibleDay;
              const away = offLabel(required, off);
              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayCell, selected && { backgroundColor: T.accentSoft }]}
                  onPress={() => setSelectedDay(day)}
                  accessibilityLabel={formatDayLong(day)}
                  accessibilityState={{ selected }}
                  testID={`week-day-${day}`}
                >
                  <Text style={[styles.weekday, { color: day === today ? T.accent : T.textDim }]}>
                    {weekdayShort(day)}
                  </Text>
                  <Text
                    style={[
                      styles.dayNumber,
                      { color: required === 0 ? T.textDim : T.textBright },
                      day === today && { color: T.accent },
                    ]}
                  >
                    {dayOfMonth(day)}
                  </Text>
                  <Text style={[styles.dayMinutes, { color: statusColor[status] }]}>
                    {totals[day] > 0 ? formatMinutes(totals[day]) : required > 0 ? "0m" : "-"}
                  </Text>
                  {away && <Text style={[styles.away, { color: T.textDim }]}>{away}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}>
            <View style={styles.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.dayTitle, { color: T.textBright }]}>
                  {formatDayLong(visibleDay)}
                </Text>
                <Text style={[styles.sub, { color: T.textDim }]}>
                  {requirementNote(requirement.required, requirement.off)}
                </Text>
              </View>
              <Text
                style={[
                  styles.dayTotal,
                  { color: statusColor[dayStatus(totals[visibleDay], requirement.required)] },
                ]}
                testID="day-total"
              >
                {formatMinutes(totals[visibleDay])}
              </Text>
            </View>

            {dayEntries.length === 0 ? (
              <Text style={[styles.nothing, { color: T.textDim }]}>Nothing logged this day.</Text>
            ) : (
              dayEntries.map((entry) => {
                const label = labels[entry.taskId];
                return (
                  <TouchableOpacity
                    key={entry.id}
                    style={[styles.entry, { borderTopColor: T.border }]}
                    onPress={() => setSheet({ kind: "edit", entry })}
                    disabled={dayLock !== undefined}
                    accessibilityLabel={`Edit ${formatMinutes(entry.durationMinutes)} on ${label?.title ?? "task"}`}
                    testID="day-entry"
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.entryTitle, { color: T.textBright }]} numberOfLines={1}>
                        {label?.code ? (
                          <Text style={{ color: T.textDim }}>{label.code} </Text>
                        ) : null}
                        {label?.title ?? "Task"}
                      </Text>
                      {entry.description ? (
                        <Text style={[styles.entryNote, { color: T.textDim }]} numberOfLines={1}>
                          {entry.description}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.entryMinutes, { color: T.text }]}>
                      {formatMinutes(entry.durationMinutes)}
                    </Text>
                    {dayLock === undefined && (
                      <TouchableOpacity
                        hitSlop={HIT_SLOP}
                        onPress={() => removeEntry(entry)}
                        accessibilityLabel="Delete entry"
                        testID="day-entry-delete"
                      >
                        <Trash size={16} color={T.textDim} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })
            )}

            {dayLock !== undefined ? (
              <View
                style={[styles.addRow, styles.lockRow, { borderTopColor: T.border }]}
                testID="day-locked"
              >
                <Lock size={14} color={T.textDim} />
                <Text style={[styles.lockLabel, { color: T.textDim }]}>{dayLock}</Text>
              </View>
            ) : (
              policy?.enabled !== false && (
                <TouchableOpacity
                  style={[styles.addRow, { borderTopColor: T.border }]}
                  onPress={() => setSheet({ kind: "pick" })}
                  testID="day-add"
                >
                  <Plus size={14} color={T.accent} weight="bold" />
                  <Text style={[styles.addLabel, { color: T.accent }]}>Add entry</Text>
                </TouchableOpacity>
              )
            )}
          </View>
        </ScrollView>
      )}

      <WeekTaskPickerSheet
        visible={sheet?.kind === "pick"}
        onClose={() => setSheet(null)}
        weekTasks={weekTasks}
        internalTasks={internalTasks}
        onPick={pickTask}
        accentColor={T.accent}
      />

      <LogTimeSheet
        visible={logging !== null}
        onClose={() => setSheet(null)}
        taskTitle={logging?.title ?? ""}
        defaultDay={visibleDay}
        accentColor={T.accent}
        saving={createWorklog.isPending}
        onSave={(entry) => {
          if (!logging) return;
          createWorklog.mutate(
            { taskId: logging.id, ...entry },
            { onSuccess: () => setSheet(null) },
          );
        }}
      />

      <LogTimeSheet
        visible={editing !== null}
        onClose={() => setSheet(null)}
        title="Edit time entry"
        taskTitle={editing ? (labels[editing.taskId]?.title ?? "Task") : ""}
        initial={
          editing
            ? {
                workDate: editing.workDate,
                durationMinutes: editing.durationMinutes,
                description: editing.description,
                startedAt: editing.startedAt,
              }
            : undefined
        }
        accentColor={T.accent}
        saving={updateWorklog.isPending}
        onSave={(entry) => {
          if (!editing) return;
          updateWorklog.mutate(
            { worklogId: editing.id, ...entry },
            { onSuccess: () => setSheet(null) },
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center" },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  total: { fontSize: 18, fontFamily: FONT.semibold },
  todayLink: { fontSize: 13, fontFamily: FONT.medium },
  strip: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
  },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
    gap: 2,
    minHeight: 72,
  },
  weekday: { fontSize: 10, fontFamily: FONT.medium, textTransform: "uppercase" },
  dayNumber: { fontSize: 15, fontFamily: FONT.semibold },
  dayMinutes: { fontSize: 10, fontFamily: FONT.medium, fontVariant: ["tabular-nums"] },
  away: { fontSize: 9, fontFamily: FONT.regular },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  dayTitle: { fontSize: 15, fontFamily: FONT.medium },
  sub: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  dayTotal: { fontSize: 17, fontFamily: FONT.semibold, fontVariant: ["tabular-nums"] },
  nothing: { fontSize: 13, fontFamily: FONT.regular, paddingHorizontal: 14, paddingBottom: 14 },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  entryTitle: { fontSize: 14, fontFamily: FONT.medium },
  entryNote: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  entryMinutes: { fontSize: 14, fontFamily: FONT.semibold, fontVariant: ["tabular-nums"] },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addLabel: { fontSize: 13, fontFamily: FONT.medium },
  reviewLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reviewLabel: { flex: 1, fontSize: 15, fontFamily: FONT.semibold },
  reviewCount: { fontSize: 13, fontFamily: FONT.medium },
  lockRow: { paddingHorizontal: 16 },
  lockLabel: { flexShrink: 1, fontSize: 13, fontFamily: FONT.regular },
});
