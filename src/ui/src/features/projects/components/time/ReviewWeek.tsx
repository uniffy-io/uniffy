import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CaretLeft, CaretRight, Check, HourglassHigh, X } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { MentionChipCompact } from "@/components/mention";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PaneBackLink, PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { cn } from "@/shared/utils/cn";
import { effectiveDayKey, formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import {
  selectPersonSheet,
  selectPersonWeek,
  selectPersonWeekDays,
  selectTimePolicy,
} from "@/features/projects/store/timeSlice";
import {
  approveTimesheet,
  fetchPersonTimesheet,
  fetchPersonWorklogs,
  fetchTimePolicy,
  grantGrace,
  personRangeKey,
  rejectTimesheet,
} from "@/features/projects/store/timeThunks";
import {
  addDays,
  buildWeekRows,
  dayStatus,
  dayTotals,
  normalizeWeekStart,
  offLabel,
  requirementsFor,
  rowMinutes,
  sumMinutes,
  taskUrn,
  weekDays,
  weekStartOf,
  type DayStatus,
} from "@/features/projects/utils/timeWeek";
import { graceActive, periodLabel } from "@/features/projects/utils/timesheet";
import { StatusPill } from "@/features/projects/components/time/PeriodBanner";
import { useTaskLabels } from "@/features/projects/components/time/useTaskLabels";

const STATUS_COLOR: Record<DayStatus, string | undefined> = {
  none: undefined,
  logged: undefined,
  under: STATUS_HEX_COLORS.warning,
  met: STATUS_HEX_COLORS.success,
  over: STATUS_HEX_COLORS.success,
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GRACE_HOURS = 24;
// A reviewer knows nothing about the person's days until the server answers.
const NO_RULE = { requiredMinutesPerDay: 0, workdays: [], holidays: [] };

function weekdayShort(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

interface ReviewWeekProps {
  userId: string;
  initialDay: string;
}

/** One person's week as their reviewer sees it: read-only cells and the sheet's review bar. */
function HeaderDivider() {
  return <div className="hidden h-5 w-px shrink-0 bg-border lg:block" aria-hidden />;
}

export function ReviewWeek({ userId, initialDay }: ReviewWeekProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const policy = useAppSelector(selectTimePolicy);
  const { weekStart: preferredWeekStart } = useAppearanceSettings();
  const weekStart = normalizeWeekStart(policy?.weekStart ?? preferredWeekStart);
  const today = effectiveDayKey(new Date());
  const [anchor, setAnchor] = useState(initialDay);
  const days = useMemo(() => weekDays(weekStartOf(anchor, weekStart)), [anchor, weekStart]);
  const key = personRangeKey(userId, days[0], days[6]);
  const selectWorklogs = useMemo(() => selectPersonWeek(key), [key]);
  const worklogs = useAppSelector(selectWorklogs);
  const servedDays = useAppSelector(selectPersonWeekDays(key));
  const [loadedSheet, setLoadedSheet] = useState<{ day: string; periodStart: string } | null>(null);
  const sheetStart = loadedSheet?.day === days[0] ? loadedSheet.periodStart : "";
  const sheet = useAppSelector(selectPersonSheet(userId, sheetStart));
  const { subjects } = useSubjectResolver([userId]);
  const person = subjects[0];
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [graceOpen, setGraceOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!policy) void dispatch(fetchTimePolicy());
  }, [dispatch, policy]);

  useEffect(() => {
    void dispatch(fetchPersonWorklogs({ userId, from: days[0], to: days[6] }));
    if (!policy?.approvalsEnabled) return;
    let current = true;
    const request = dispatch(fetchPersonTimesheet({ userId, day: days[0] }));
    void request.then((result) => {
      if (current && fetchPersonTimesheet.fulfilled.match(result)) {
        setLoadedSheet({ day: days[0], periodStart: result.payload.periodStart });
      }
    });
    return () => {
      current = false;
      request.abort();
    };
  }, [dispatch, userId, days, policy?.approvalsEnabled]);

  const rows = useMemo(() => buildWeekRows(worklogs, days, []), [worklogs, days]);
  const rowTaskIds = useMemo(() => rows.map((row) => row.taskId), [rows]);
  const labels = useTaskLabels(rowTaskIds);
  const totals = useMemo(() => dayTotals(rows, days), [rows, days]);
  const requirements = useMemo(
    () => requirementsFor(days, servedDays, NO_RULE),
    [days, servedDays],
  );
  const weekTotal = days.reduce((sum, day) => sum + totals[day], 0);

  const run = async (action: Promise<unknown>) => {
    setBusy(true);
    try {
      await action;
    } finally {
      setBusy(false);
    }
  };

  const rangeLabel = `${formatDateShort(days[0])} to ${formatDateShort(days[6])}`;
  const canReview = sheet?.canReview ?? false;
  const pending = canReview && sheet?.status === "submitted" && !sheet.periodClosed;
  // Back to the inbox on the period being looked at, not on today's.
  const backToInbox = () =>
    navigate(`/projects/time?tab=approvals&period=${sheet?.periodStart ?? days[0]}`);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="review-week">
      <PaneHeader>
        <PaneHeaderBar
          icon={person ? <SubjectAvatar subject={person} size="sm" /> : undefined}
          title={person?.name ?? "Member"}
          subtitle={rangeLabel}
          eyebrow={
            <PaneBackLink onClick={backToInbox}>
              <CaretLeft size={12} />
              Approvals
            </PaneBackLink>
          }
        >
          {/* Left to right: which week, where it stands, what the reviewer can do with it. */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setAnchor(addDays(days[0], -7))}
              aria-label="Previous week"
              title="Previous week"
            >
              <CaretLeft size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setAnchor(addDays(days[0], 7))}
              aria-label="Next week"
              title="Next week"
            >
              <CaretRight size={14} />
            </Button>
          </div>
          <HeaderDivider />
          {sheet ? (
            <div
              className="flex min-w-0 items-center gap-2 text-xs"
              data-testid="review-bar"
              data-status={sheet.status}
            >
              <span title={periodLabel(sheet)}>
                <StatusPill status={sheet.status} locked={sheet.locked} />
              </span>
              <span className="tabular-nums" title={`Logged in ${periodLabel(sheet)}`}>
                <span className="font-semibold text-foreground">
                  {formatMinutes(sheet.totalMinutes)}
                </span>
                {sheet.requiredMinutes > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    / {formatMinutes(sheet.requiredMinutes)}
                  </span>
                )}
              </span>
              {(sheet.submitComment || sheet.reviewComment) && (
                <span
                  className="hidden max-w-56 truncate text-muted-foreground italic xl:inline"
                  title={sheet.reviewComment || sheet.submitComment}
                  data-testid="review-note"
                >
                  {sheet.reviewComment || sheet.submitComment}
                </span>
              )}
              {graceActive(sheet) && (
                <span className="text-muted-foreground" title="Grace is active">
                  <HourglassHigh size={12} />
                </span>
              )}
            </div>
          ) : (
            <div className="text-xs tabular-nums">
              <span className="font-semibold text-foreground">{formatMinutes(weekTotal)}</span>
            </div>
          )}
          {sheet && (pending || (canReview && !sheet.periodClosed)) && <HeaderDivider />}
          {sheet && canReview && !sheet.periodClosed && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setGraceOpen(true)}
              disabled={busy}
              title={`Let them edit this period for ${GRACE_HOURS} hours`}
              data-testid="review-grace"
            >
              <HourglassHigh size={12} />
              <span className="hidden lg:inline">Grace {GRACE_HOURS}h</span>
            </Button>
          )}
          {pending && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setRejectOpen(true)}
                disabled={busy}
                data-testid="review-reject"
              >
                <X size={12} />
                Reject
              </Button>
              <Button
                type="button"
                size="xs"
                onClick={() => setApproveOpen(true)}
                disabled={busy}
                data-testid="review-approve"
              >
                <Check size={12} />
                Approve
              </Button>
            </>
          )}
        </PaneHeaderBar>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table className="min-w-[720px]" rounded={false}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%] min-w-[220px]">Task</TableHead>
              {days.map((day) => (
                <TableHead
                  key={day}
                  className={cn(
                    "w-[76px] text-right tabular-nums",
                    day === today && "text-primary",
                    requirements[day].required === 0 && "text-subtle-foreground",
                  )}
                >
                  <div>{weekdayShort(day)}</div>
                  <div className="text-[10px] font-normal">{day.slice(5).replace("-", "/")}</div>
                  {offLabel(requirements[day].required, requirements[day].off) && (
                    <div
                      className="whitespace-nowrap text-[9px] font-normal normal-case tracking-normal text-subtle-foreground"
                      data-testid="review-day-off"
                    >
                      {offLabel(requirements[day].required, requirements[day].off)}
                    </div>
                  )}
                </TableHead>
              ))}
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={days.length + 2}
                  className="py-8 text-center text-xs text-subtle-foreground"
                >
                  Nothing logged this week.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.taskId} data-testid="review-week-row">
                <TableCell className="py-1">
                  <MentionChipCompact
                    urn={taskUrn(row.taskId)}
                    label={labels[row.taskId] || "Task"}
                  />
                </TableCell>
                {days.map((day) => {
                  const entries = row.cells[day] ?? [];
                  const minutes = sumMinutes(entries);
                  return (
                    <TableCell
                      key={day}
                      className="py-1 text-right text-xs tabular-nums"
                      title={entries
                        .map((entry) => entry.description)
                        .filter(Boolean)
                        .join("; ")}
                    >
                      {minutes > 0 ? formatMinutes(minutes) : ""}
                    </TableCell>
                  );
                })}
                <TableCell className="py-1 text-right text-xs font-medium tabular-nums">
                  {formatMinutes(rowMinutes(row, days))}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30">
              <TableCell className="text-xs text-muted-foreground">Total</TableCell>
              {days.map((day) => {
                const status = dayStatus(totals[day], requirements[day].required);
                return (
                  <TableCell
                    key={day}
                    className="text-right text-xs font-medium tabular-nums"
                    style={{ color: STATUS_COLOR[status] }}
                    title={
                      requirements[day].required > 0
                        ? `${formatMinutes(requirements[day].required)} required`
                        : undefined
                    }
                    data-testid="review-day-total"
                    data-status={status}
                  >
                    {totals[day] > 0
                      ? formatMinutes(totals[day])
                      : requirements[day].required > 0
                        ? "0m"
                        : ""}
                  </TableCell>
                );
              })}
              <TableCell className="text-right text-xs font-semibold tabular-nums">
                {formatMinutes(weekTotal)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      {sheet && (
        <>
          <ConfirmDialog
            isOpen={approveOpen}
            onClose={() => setApproveOpen(false)}
            onConfirm={async () => {
              await run(dispatch(approveTimesheet({ timesheetId: sheet.id })));
              setApproveOpen(false);
            }}
            title="Approve timesheet"
            message={`Approve ${formatMinutes(sheet.totalMinutes)} for ${periodLabel(sheet)}?`}
            confirmLabel="Approve"
            loading={busy}
          />
          <ReasonDialog
            isOpen={rejectOpen}
            onClose={() => setRejectOpen(false)}
            onConfirm={(comment) => {
              void run(dispatch(rejectTimesheet({ timesheetId: sheet.id, comment }))).then(() =>
                setRejectOpen(false),
              );
            }}
            title="Reject timesheet"
            description="They will see your reason on their week."
            reasonLabel="Reason"
            reasonPlaceholder="What needs to change"
            reasonRequired
            confirmLabel="Reject"
            variant="danger"
            loading={busy}
          />
          <ConfirmDialog
            isOpen={graceOpen}
            onClose={() => setGraceOpen(false)}
            onConfirm={async () => {
              await run(
                dispatch(grantGrace({ userId, day: sheet.periodStart, hours: GRACE_HOURS })),
              );
              setGraceOpen(false);
            }}
            title="Grant grace"
            message={`Let them edit ${periodLabel(sheet)} for the next ${GRACE_HOURS} hours?`}
            confirmLabel="Grant"
            loading={busy}
          />
        </>
      )}
    </div>
  );
}
