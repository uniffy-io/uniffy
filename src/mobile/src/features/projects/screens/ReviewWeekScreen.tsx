import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { CaretLeft, CaretRight, Check, HourglassHigh, X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@core/providers/AuthContext";
import { Avatar } from "@shared/components/Avatar";
import { BottomSheet } from "@shared/components/BottomSheet";
import { DomainHeader } from "@shared/components/DomainHeader";
import { SheetHeader } from "@shared/components/SheetHeader";
import { useDirectory } from "@shared/directory/useDirectory";
import { useTheme } from "@shared/hooks/useTheme";
import { zonedParts } from "@shared/lib/zonedTime";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SheetStatusChip } from "@features/projects/components/SheetStatusChip";
import { endOf, wallOf } from "@features/projects/timeClock";
import { formatMinutes } from "@features/projects/timeFormatting";
import { localDayKey, type SerializedWorklog } from "@features/projects/timeSerializer";
import { graceLeft, periodLabel, statusLook } from "@features/projects/timesheetStatus";
import {
  addDays,
  dayStatus,
  dayTotals,
  entriesByDay,
  formatDayLong,
  formatDayRange,
  normalizeWeekStart,
  offLabel,
  requirementsFor,
  weekDays,
  weekStartOf,
  type DayStatus,
} from "@features/projects/timeWeek";
import { useMyWeek, useTimePolicy, useTimesheet } from "@features/projects/useMyTime";
import { useTaskLabels } from "@features/projects/useTaskLabels";
import {
  useApproveTimesheet,
  useGrantGrace,
  useRejectTimesheet,
} from "@features/projects/useTimeReview";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };
const GRACE_HOURS = 24;
const ACTION_GAP = 8;
// The keyboard lifts the sheet over a few frames; scrolling before it settles lands short.
const KEYBOARD_SETTLE_MS = 250;

function clockOf(entry: SerializedWorklog): string | null {
  if (!entry.startedAt) return null;
  const parts = zonedParts(new Date(entry.startedAt));
  const start = wallOf(parts.hour * 60 + parts.minute);
  return `${start} to ${endOf(start, entry.durationMinutes)}`;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Asks for the reason a rejected sheet carries back to its person. */
function RejectSheet({
  visible,
  busy,
  onClose,
  onReject,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const T = useTheme();
  const scroll = useRef<ScrollView>(null);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  if (visible && !open) {
    setOpen(true);
    setReason("");
  }
  if (!visible && open) setOpen(false);
  const trimmed = reason.trim();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SheetHeader
        title="Reject timesheet"
        actions={[
          {
            label: busy ? "Sending" : "Reject",
            onPress: () => trimmed && onReject(trimmed),
            disabled: busy || !trimmed,
          },
        ]}
      />
      <ScrollView
        ref={scroll}
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetBody}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.sheetLead, { color: T.textDim }]}>
          They will see your reason on their week.
        </Text>
        <Text style={[styles.label, { color: T.textDim }]}>Reason</Text>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: T.pageBg, borderColor: T.border, color: T.textBright },
          ]}
          value={reason}
          onChangeText={setReason}
          onFocus={() =>
            setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), KEYBOARD_SETTLE_MS)
          }
          placeholder="What needs to change"
          placeholderTextColor={T.textDim}
          multiline
          autoFocus
          testID="reject-reason"
        />
      </ScrollView>
    </BottomSheet>
  );
}

/** One person's week as their reviewer sees it: read-only entries and the review actions. */
export function ReviewWeekScreen() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { byId } = useDirectory();
  const params = useLocalSearchParams<{ userId: string; day?: string }>();
  const userId = params.userId;
  const today = localDayKey();
  const [anchor, setAnchor] = useState(params.day || today);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [actionsWidth, setActionsWidth] = useState(0);

  const policyQuery = useTimePolicy();
  const policy = policyQuery.data;
  const weekStart = normalizeWeekStart(policy?.weekStart);
  const days = useMemo(() => weekDays(weekStartOf(anchor, weekStart)), [anchor, weekStart]);
  const weekQuery = useMyWeek(days[0], days[6], userId);
  const sheetQuery = useTimesheet(days[0], policy?.approvalsEnabled === true, userId);
  const sheet = sheetQuery.data;
  const worklogs = useMemo(() => weekQuery.data?.worklogs ?? [], [weekQuery.data]);
  const served = useMemo(() => weekQuery.data?.days ?? [], [weekQuery.data]);
  const labels = useTaskLabels(worklogs.map((entry) => entry.taskId));

  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const grace = useGrantGrace();
  const busy = approve.isPending || reject.isPending || grace.isPending;

  const byDay = useMemo(() => entriesByDay(worklogs), [worklogs]);
  const totals = useMemo(() => dayTotals(worklogs, days), [worklogs, days]);
  const requirements = useMemo(() => requirementsFor(days, served), [days, served]);
  const weekTotal = days.reduce((sum, day) => sum + totals[day], 0);
  const weekRequired = days.reduce((sum, day) => sum + requirements[day].required, 0);

  const person = byId.get(userId);
  const name = person?.name ?? "Member";
  const canReview = sheet?.canReview === true && !sheet.periodClosed;
  const pending = canReview && sheet?.status === "submitted";
  const look = sheet ? statusLook(sheet.status, sheet.locked, sheet.periodClosed) : null;
  const graceFor = sheet ? graceLeft(sheet) : null;
  const sentTo = sheet?.submittedToUserId;

  const statusColor: Record<DayStatus, string> = {
    none: T.textDim,
    logged: T.text,
    under: T.yellow,
    met: T.green,
    over: T.green,
  };

  // An equal share of the measured row: flex shares follow the labels' widths on Android.
  const actionCount = pending ? 3 : 1;
  const actionWidth =
    actionsWidth > 0
      ? { width: (actionsWidth - ACTION_GAP * (actionCount - 1)) / actionCount }
      : null;

  const confirmApprove = () => {
    if (!sheet) return;
    Alert.alert(
      "Approve timesheet",
      `Approve ${formatMinutes(sheet.totalMinutes)} for ${periodLabel(sheet)}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Approve", onPress: () => approve.mutate({ timesheetId: sheet.id }) },
      ],
    );
  };

  const confirmGrace = () => {
    if (!sheet) return;
    Alert.alert(
      "Grant grace",
      `Let ${name} edit ${periodLabel(sheet)} for the next ${GRACE_HOURS} hours?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Grant",
          onPress: () => grace.mutate({ userId, day: sheet.periodStart, hours: GRACE_HOURS }),
        },
      ],
    );
  };

  const shownDays = days.filter(
    (day) => (byDay[day]?.length ?? 0) > 0 || requirements[day].required > 0,
  );
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={name}
        subtitle={formatDayRange(days[0], days[6])}
        color={T.accent}
        icon="projects"
        leading={<Avatar name={name} avatarUrl={person?.avatarUrl} size={30} circle />}
        rightActions={
          <>
            <TouchableOpacity
              hitSlop={HIT_SLOP}
              onPress={() => setAnchor(addDays(days[0], -7))}
              accessibilityLabel="Previous week"
              testID="review-previous"
            >
              <CaretLeft size={20} color={T.text} weight="bold" />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={HIT_SLOP}
              onPress={() => setAnchor(addDays(days[0], 7))}
              accessibilityLabel="Next week"
              testID="review-next"
            >
              <CaretRight size={20} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      {weekQuery.isLoading && !weekQuery.data ? (
        <ActivityIndicator style={{ padding: 32 }} size="large" color={T.accent} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={weekQuery.isRefetching}
              onRefresh={() => {
                void weekQuery.refetch();
                void sheetQuery.refetch();
              }}
              tintColor={T.accent}
            />
          }
        >
          <Text style={[styles.total, { color: T.textBright }]} testID="review-total">
            {formatMinutes(weekTotal)}
            {weekRequired > 0 && (
              <Text style={{ color: T.textDim }}> of {formatMinutes(weekRequired)}</Text>
            )}
          </Text>

          {sheet && look && (
            <View
              style={[
                styles.card,
                styles.sheetCard,
                { backgroundColor: T.surface, borderColor: T.border },
              ]}
              testID="review-sheet"
            >
              <View style={styles.sheetHead}>
                <SheetStatusChip
                  label={look.label}
                  tone={look.tone}
                  status={sheet.status}
                  locked={sheet.locked}
                  periodClosed={sheet.periodClosed}
                  testID="review-status"
                />
                <Text style={[styles.period, { color: T.textDim }]}>{periodLabel(sheet)}</Text>
              </View>
              {sheet.status === "submitted" && sheet.submittedAt ? (
                <Text style={[styles.detail, { color: T.textDim }]}>
                  Sent {shortDate(sheet.submittedAt)}
                  {sentTo
                    ? sentTo === user?.id
                      ? " to you"
                      : ` to ${byId.get(sentTo)?.name ?? "another reviewer"}`
                    : " to every reviewer"}
                  .
                </Text>
              ) : null}
              {sheet.submitComment ? (
                <Text style={[styles.note, { color: T.text }]} testID="review-submit-note">
                  "{sheet.submitComment}"
                </Text>
              ) : null}
              {sheet.reviewComment ? (
                <Text style={[styles.detail, { color: T.textDim }]} testID="review-comment">
                  Review: {sheet.reviewComment}
                </Text>
              ) : null}
              {graceFor ? (
                <View style={styles.graceRow}>
                  <HourglassHigh size={13} color={T.textDim} />
                  <Text style={[styles.detail, { color: T.textDim }]}>
                    Open for edits {graceFor}.
                  </Text>
                </View>
              ) : null}

              {canReview && (
                <View
                  style={styles.actions}
                  onLayout={(event) => setActionsWidth(event.nativeEvent.layout.width)}
                >
                  {busy ? (
                    <ActivityIndicator color={T.accent} />
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[
                          styles.action,
                          actionWidth,
                          { borderColor: T.border, borderWidth: 1 },
                        ]}
                        onPress={confirmGrace}
                        testID="review-grace"
                      >
                        <HourglassHigh size={14} color={T.text} />
                        <Text style={[styles.actionText, { color: T.text }]} numberOfLines={1}>
                          Grace
                        </Text>
                      </TouchableOpacity>
                      {pending && (
                        <>
                          <TouchableOpacity
                            style={[
                              styles.action,
                              actionWidth,
                              { borderColor: T.red, borderWidth: 1 },
                            ]}
                            onPress={() => setRejectOpen(true)}
                            testID="review-reject"
                          >
                            <X size={14} color={T.red} weight="bold" />
                            <Text style={[styles.actionText, { color: T.red }]} numberOfLines={1}>
                              Reject
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.action, actionWidth, { backgroundColor: T.accent }]}
                            onPress={confirmApprove}
                            testID="review-approve"
                          >
                            <Check size={14} color="#fff" weight="bold" />
                            <Text style={[styles.actionText, { color: "#fff" }]} numberOfLines={1}>
                              Approve
                            </Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </>
                  )}
                </View>
              )}
            </View>
          )}

          {shownDays.length === 0 ? (
            <Text style={[styles.empty, { color: T.textDim }]}>Nothing logged this week.</Text>
          ) : (
            shownDays.map((day) => {
              const entries = byDay[day] ?? [];
              const { required, off } = requirements[day];
              const away = offLabel(required, off);
              return (
                <View
                  key={day}
                  style={[styles.card, { backgroundColor: T.surface, borderColor: T.border }]}
                  testID="review-day"
                >
                  <View style={styles.dayHead}>
                    <Text style={[styles.dayTitle, { color: T.textBright }]}>
                      {formatDayLong(day)}
                      {away ? <Text style={{ color: T.textDim }}> · {away}</Text> : null}
                    </Text>
                    <Text
                      style={[
                        styles.dayTotal,
                        { color: statusColor[dayStatus(totals[day], required)] },
                      ]}
                    >
                      {formatMinutes(totals[day])}
                      {required > 0 && (
                        <Text style={{ color: T.textDim }}> / {formatMinutes(required)}</Text>
                      )}
                    </Text>
                  </View>
                  {entries.length === 0 ? (
                    <Text style={[styles.nothing, { color: T.textDim }]}>Nothing logged.</Text>
                  ) : (
                    entries.map((entry) => {
                      const label = labels[entry.taskId];
                      const clock = clockOf(entry);
                      return (
                        <View
                          key={entry.id}
                          style={[styles.entry, { borderTopColor: T.border }]}
                          testID="review-entry"
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[styles.entryTitle, { color: T.textBright }]}
                              numberOfLines={1}
                            >
                              {label?.code ? (
                                <Text style={{ color: T.textDim }}>{label.code} </Text>
                              ) : null}
                              {label?.title ?? "Task"}
                            </Text>
                            {clock || entry.description ? (
                              <Text
                                style={[styles.entryNote, { color: T.textDim }]}
                                numberOfLines={2}
                              >
                                {[clock, entry.description].filter(Boolean).join(" · ")}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={[styles.entryMinutes, { color: T.text }]}>
                            {formatMinutes(entry.durationMinutes)}
                          </Text>
                        </View>
                      );
                    })
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <RejectSheet
        visible={rejectOpen}
        busy={reject.isPending}
        onClose={() => setRejectOpen(false)}
        onReject={(comment) => {
          if (!sheet) return;
          reject.mutate(
            { timesheetId: sheet.id, comment },
            { onSuccess: () => setRejectOpen(false) },
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  total: { fontSize: 22, fontFamily: FONT.bold },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sheetCard: { padding: 14, gap: 8 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  period: { fontSize: 12, fontFamily: FONT.regular },
  detail: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  note: { fontSize: 14, fontFamily: FONT.regular, fontStyle: "italic", lineHeight: 19 },
  graceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  // The actions split the row evenly whatever their labels.
  actions: { flexDirection: "row", gap: ACTION_GAP, marginTop: 4 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 9,
  },
  actionText: { flexShrink: 1, fontSize: 13, fontFamily: FONT.semibold },
  empty: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 24 },
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    gap: 8,
  },
  dayTitle: { fontSize: 15, fontFamily: FONT.semibold, flexShrink: 1 },
  dayTotal: { fontSize: 14, fontFamily: FONT.semibold },
  nothing: { fontSize: 13, fontFamily: FONT.regular, paddingHorizontal: 14, paddingBottom: 14 },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  entryTitle: { fontSize: 14, fontFamily: FONT.medium },
  entryNote: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  entryMinutes: { fontSize: 14, fontFamily: FONT.semibold },
  sheetScroll: { flexShrink: 1 },
  sheetBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  sheetLead: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  label: { fontSize: 12, fontFamily: FONT.medium, marginTop: 6 },
  input: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: FONT.regular,
    minHeight: 88,
    textAlignVertical: "top",
  },
});
