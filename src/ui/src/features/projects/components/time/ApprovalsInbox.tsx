import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  Check,
  HourglassHigh,
  ListChecks,
  Lock,
  LockOpen,
  X,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import type { Subject } from "@/components/subject/types";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { PaneHeader, PaneHeaderBar } from "@/components/ui/pane-header";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { GroupKind } from "@uniffy/proto/common/v1/common_pb";
import { cn } from "@/shared/utils/cn";
import { formatDateShort } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import type { SerializedGroupInfo } from "@/features/admin/store/adminSlice";
import type { ReviewRow, TimesheetStatus } from "@/features/projects/types/time";
import { selectReview } from "@/features/projects/store/timeSlice";
import {
  approveTimesheet,
  closePeriod,
  fetchReviewTimesheets,
  grantGrace,
  rejectTimesheet,
  reopenPeriod,
} from "@/features/projects/store/timeThunks";
import { addDays, dayStatus, offLabel } from "@/features/projects/utils/timeWeek";
import { graceActive } from "@/features/projects/utils/timesheet";
import { StatusPill } from "./PeriodBanner";

type StatusFilter = "all" | TimesheetStatus;

const STATUS_OPTIONS: { value: StatusFilter; content: ReactNode; title: string }[] = [
  { value: "all", content: "All", title: "Everyone" },
  { value: "open", content: "Open", title: "Not submitted yet" },
  { value: "submitted", content: "Submitted", title: "Waiting for review" },
  { value: "approved", content: "Approved", title: "Approved" },
  { value: "rejected", content: "Rejected", title: "Sent back" },
];

const GRACE_HOURS_DEFAULT = 24;
const GRACE_HOURS_MAX = 336;
const SEARCH_DEBOUNCE_MS = 250;

const METER_COLOR = {
  none: "var(--color-border)",
  logged: STATUS_HEX_COLORS.info ?? STATUS_HEX_COLORS.success,
  under: STATUS_HEX_COLORS.warning,
  met: STATUS_HEX_COLORS.success,
  over: STATUS_HEX_COLORS.success,
} as const;

function DayMeters({ row }: { row: ReviewRow }) {
  return (
    <div className="flex items-end gap-0.5" data-testid="day-meters">
      {row.days.map((day) => {
        const status = dayStatus(day.minutes, day.requiredMinutes);
        const scale = Math.max(day.requiredMinutes, 480);
        const height = Math.max(2, Math.min(16, Math.round((day.minutes / scale) * 16)));
        const away = offLabel(day.requiredMinutes, day.off);
        return (
          <span
            key={day.day}
            className={cn("inline-block w-2 rounded-sm", away && "opacity-60")}
            style={{ height, backgroundColor: METER_COLOR[status] }}
            title={`${formatDateShort(day.day)}: ${formatMinutes(day.minutes)}${
              day.requiredMinutes ? ` of ${formatMinutes(day.requiredMinutes)}` : ""
            }${away ? ` (${away})` : ""}`}
            data-off={away ? "true" : undefined}
          />
        );
      })}
    </div>
  );
}

interface ApprovalsInboxProps {
  initialDay: string;
  headerExtra?: ReactNode;
}

/** Every person the viewer reviews, one period at a time, with approve, reject and grace. */
export function ApprovalsInbox({ initialDay, headerExtra }: ApprovalsInboxProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const review = useAppSelector(selectReview);
  const groups = useAppSelector((state) => state.admin.groups) as SerializedGroupInfo[];
  const [anchor, setAnchor] = useState(initialDay);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [teamId, setTeamId] = useState("");
  const [approving, setApproving] = useState<ReviewRow | null>(null);
  const [rejecting, setRejecting] = useState<ReviewRow | null>(null);
  const [gracing, setGracing] = useState<ReviewRow | null>(null);
  const [graceHours, setGraceHours] = useState(GRACE_HOURS_DEFAULT);
  const [periodDialog, setPeriodDialog] = useState<"close" | "reopen" | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void dispatch(
        fetchReviewTimesheets({
          periodStart: anchor,
          ...(status !== "all" ? { status } : {}),
          query,
          ...(teamId ? { teamId } : {}),
        }),
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [dispatch, anchor, status, query, teamId]);

  const userIds = useMemo(() => review.rows.map((row) => row.userId), [review.rows]);
  const { subjects } = useSubjectResolver(userIds);
  const subjectMap = useMemo(() => {
    const map: Record<string, Subject> = {};
    for (const subject of subjects) map[subject.id] = subject;
    return map;
  }, [subjects]);
  const teamOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: "", label: "All teams" },
      ...groups
        .filter((group) => group.kind === GroupKind.TEAM)
        .map((group) => ({ value: group.id, label: group.name })),
    ],
    [groups],
  );

  const period = review.period;
  const periodClosed = period?.status === "closed";
  const rangeLabel = period
    ? `${formatDateShort(period.startDate)} to ${formatDateShort(period.endDate)}`
    : "";

  const run = async (action: Promise<unknown>) => {
    setBusy(true);
    try {
      await action;
    } finally {
      setBusy(false);
    }
  };

  const confirmApprove = async () => {
    if (!approving) return;
    await run(dispatch(approveTimesheet({ timesheetId: approving.timesheet.id })));
    setApproving(null);
  };

  const confirmReject = async (comment: string) => {
    if (!rejecting) return;
    await run(dispatch(rejectTimesheet({ timesheetId: rejecting.timesheet.id, comment })));
    setRejecting(null);
  };

  const confirmGrace = async () => {
    if (!gracing || !period) return;
    await run(
      dispatch(grantGrace({ userId: gracing.userId, day: period.startDate, hours: graceHours })),
    );
    setGracing(null);
  };

  const confirmPeriod = async () => {
    if (!period || !periodDialog) return;
    const thunk = periodDialog === "close" ? closePeriod : reopenPeriod;
    await run(dispatch(thunk({ day: period.startDate })));
    setPeriodDialog(null);
    void dispatch(
      fetchReviewTimesheets({
        periodStart: anchor,
        ...(status !== "all" ? { status } : {}),
        query,
        ...(teamId ? { teamId } : {}),
      }),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="approvals-inbox">
      <PaneHeader>
        <PaneHeaderBar icon={ListChecks} title="Approvals" subtitle={rangeLabel} divided>
          {headerExtra}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => period && setAnchor(addDays(period.startDate, -1))}
              aria-label="Previous period"
              data-testid="period-previous"
            >
              <CaretLeft size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => period && setAnchor(addDays(period.endDate, 1))}
              aria-label="Next period"
              data-testid="period-next"
            >
              <CaretRight size={14} />
            </Button>
          </div>
          {periodClosed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Lock size={10} />
              Closed
            </span>
          )}
          {review.viewerIsTimekeepingAdmin && period && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setPeriodDialog(periodClosed ? "reopen" : "close")}
              data-testid={periodClosed ? "period-reopen" : "period-close"}
            >
              {periodClosed ? <LockOpen size={14} /> : <Lock size={14} />}
              <span className="hidden md:inline">
                {periodClosed ? "Reopen period" : "Close period"}
              </span>
            </Button>
          )}
        </PaneHeaderBar>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 md:px-4">
          <SegmentedControl
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            ariaLabel="Timesheet status"
          />
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Search people"
            size="sm"
            containerClassName="w-48"
            data-testid="review-search"
          />
          {teamOptions.length > 1 && (
            <Select
              value={teamId}
              onChange={setTeamId}
              options={teamOptions}
              triggerClassName="h-8 w-44 text-xs"
            />
          )}
        </div>
      </PaneHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="hidden md:table-cell">Days</TableHead>
              <TableHead className="text-right">Logged</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {review.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-xs text-subtle-foreground">
                  {review.loading ? "Loading timesheets" : "Nobody to review in this period."}
                </TableCell>
              </TableRow>
            )}
            {review.rows.map((row) => {
              const subject = subjectMap[row.userId];
              const sheet = row.timesheet;
              const grace = graceActive(sheet);
              const pending = sheet.status === "submitted" && !periodClosed;
              return (
                <TableRow key={row.userId} data-testid="review-row" data-status={sheet.status}>
                  <TableCell className="py-1.5">
                    <div className="flex items-center gap-2">
                      {subject && <SubjectAvatar subject={subject} size="xs" />}
                      <span className="truncate text-sm">{subject?.name ?? "Member"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <DayMeters row={row} />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    <span
                      className={cn(
                        "font-medium",
                        row.requiredMinutes > 0 &&
                          row.periodMinutes < row.requiredMinutes &&
                          "text-yellow-700 dark:text-yellow-400",
                      )}
                    >
                      {formatMinutes(row.periodMinutes)}
                    </span>
                    {row.requiredMinutes > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        / {formatMinutes(row.requiredMinutes)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusPill status={sheet.status} locked={sheet.locked} />
                      {grace && (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                          title="Grace granted"
                        >
                          <HourglassHigh size={10} />
                          grace
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {pending && (
                        <>
                          <Button
                            type="button"
                            size="xs"
                            onClick={() => setApproving(row)}
                            disabled={busy}
                            data-testid="review-approve"
                          >
                            <Check size={12} />
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setRejecting(row)}
                            disabled={busy}
                            data-testid="review-reject"
                          >
                            <X size={12} />
                            Reject
                          </Button>
                        </>
                      )}
                      {!periodClosed && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setGraceHours(GRACE_HOURS_DEFAULT);
                            setGracing(row);
                          }}
                          disabled={busy}
                          title="Let them edit this period for a while"
                          data-testid="review-grace"
                        >
                          <HourglassHigh size={12} />
                          <span className="hidden lg:inline">Grace</span>
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          navigate(
                            `/projects/time/review/${row.userId}?day=${period?.startDate ?? anchor}`,
                          )
                        }
                        title="Open their week"
                        data-testid="review-open"
                      >
                        <ArrowSquareOut size={12} />
                        <span className="hidden lg:inline">Open week</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {review.nextPageToken && (
          <div className="p-3 text-center">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={review.loading}
              onClick={() =>
                void dispatch(
                  fetchReviewTimesheets({
                    periodStart: anchor,
                    ...(status !== "all" ? { status } : {}),
                    query,
                    ...(teamId ? { teamId } : {}),
                    pageToken: review.nextPageToken,
                  }),
                )
              }
            >
              Load more
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={approving !== null}
        onClose={() => setApproving(null)}
        onConfirm={confirmApprove}
        title="Approve timesheet"
        message={
          approving
            ? `Approve ${formatMinutes(approving.periodMinutes)} from ${subjectMap[approving.userId]?.name ?? "this person"} for ${rangeLabel}?`
            : ""
        }
        confirmLabel="Approve"
        loading={busy}
      />
      <ReasonDialog
        isOpen={rejecting !== null}
        onClose={() => setRejecting(null)}
        onConfirm={(comment) => void confirmReject(comment)}
        title="Reject timesheet"
        description={
          rejecting
            ? `Send ${rangeLabel} back to ${subjectMap[rejecting.userId]?.name ?? "this person"}. They will see your reason.`
            : undefined
        }
        reasonLabel="Reason"
        reasonPlaceholder="What needs to change"
        reasonRequired
        confirmLabel="Reject"
        variant="danger"
        loading={busy}
      />
      {gracing && (
        <Modal onClose={() => setGracing(null)} maxWidth="max-w-sm" ariaLabel="Grant grace">
          <ModalHeader
            title="Grant grace"
            description={`Let ${subjectMap[gracing.userId]?.name ?? "this person"} edit ${rangeLabel} for a while.`}
          />
          <ModalBody>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="grace-hours">
              Hours from now
            </label>
            <NumberInput
              id="grace-hours"
              value={graceHours}
              min={1}
              max={GRACE_HOURS_MAX}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isNaN(parsed)) {
                  setGraceHours(Math.min(GRACE_HOURS_MAX, Math.max(1, Math.round(parsed))));
                }
              }}
              className="w-28"
              data-testid="grace-hours"
            />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setGracing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void confirmGrace()}
              disabled={busy}
              data-testid="grace-confirm"
            >
              Grant {graceHours}h
            </Button>
          </ModalFooter>
        </Modal>
      )}
      <ConfirmDialog
        isOpen={periodDialog !== null}
        onClose={() => setPeriodDialog(null)}
        onConfirm={confirmPeriod}
        title={periodDialog === "close" ? "Close period" : "Reopen period"}
        message={
          periodDialog === "close"
            ? `Close ${rangeLabel} for everyone? No entry in it can change until it is reopened.`
            : `Reopen ${rangeLabel}? Sheets return to the state they had before the close.`
        }
        confirmLabel={periodDialog === "close" ? "Close period" : "Reopen"}
        loading={busy}
      />
    </div>
  );
}
