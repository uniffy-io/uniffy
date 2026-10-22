import { useState } from "react";
import { CheckCircle, HourglassHigh, Lock, PaperPlaneTilt, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ReasonDialog } from "@/components/ui/reason-dialog";
import { cn } from "@/shared/utils/cn";
import { formatDateShort, formatTimeRemaining } from "@/shared/utils/dateFormatting";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import type { Timesheet, TimesheetStatus } from "@/features/projects/types/time";
import {
  STATUS_LABEL,
  STATUS_TONE,
  graceActive,
  periodLabel,
  type SheetTone,
} from "@/features/projects/utils/timesheet";

const TONE_CLASS: Record<SheetTone, string> = {
  default: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
  success: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function StatusPill({
  status,
  locked,
  className,
}: {
  status: TimesheetStatus;
  locked?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASS[STATUS_TONE[status]],
        className,
      )}
      data-testid="sheet-status"
      data-status={status}
    >
      {locked && <Lock size={10} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

interface PeriodBannerProps {
  sheet: Timesheet;
  busy: boolean;
  onSubmit: (comment: string) => void;
  onRecall: () => void;
}

/** The state of one period of the person's own time: open, submitted, reviewed, locked or closed. */
export function PeriodBanner({ sheet, busy, onSubmit, onRecall }: PeriodBannerProps) {
  const [submitOpen, setSubmitOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const grace = graceActive(sheet);
  const label = periodLabel(sheet);

  let tone: SheetTone = STATUS_TONE[sheet.status];
  let Icon = HourglassHigh;
  let detail: string;
  if (sheet.periodClosed) {
    tone = "default";
    Icon = Lock;
    detail = "A timekeeping admin closed this period; entries cannot change.";
  } else if (sheet.status === "approved") {
    Icon = CheckCircle;
    detail = sheet.reviewComment || "Your reviewer approved this period.";
  } else if (sheet.status === "submitted") {
    Icon = PaperPlaneTilt;
    detail = sheet.submittedAt
      ? `Waiting for review since ${formatDateShort(sheet.submittedAt)}.`
      : "Waiting for review.";
  } else if (sheet.status === "rejected") {
    Icon = XCircle;
    detail = sheet.reviewComment
      ? `Rejected: ${sheet.reviewComment}`
      : "Rejected by your reviewer.";
  } else if (sheet.locked) {
    tone = "warning";
    Icon = Lock;
    detail = "The period ended and its lock date has passed; ask your reviewer to reopen it.";
  } else {
    detail = `${formatMinutes(sheet.totalMinutes)} of ${formatMinutes(sheet.requiredMinutes)} logged.`;
  }
  if (grace && sheet.graceUntil) {
    detail += ` Open for edits ${formatTimeRemaining(sheet.graceUntil)}.`;
  }

  const canSubmit =
    !sheet.periodClosed &&
    (sheet.status === "open" || sheet.status === "rejected") &&
    (!sheet.locked || grace);
  const canRecall = !sheet.periodClosed && sheet.status === "submitted";

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-strong px-4 py-2 text-xs"
      data-testid="period-banner"
      data-status={sheet.periodClosed ? "closed" : sheet.status}
      data-locked={sheet.locked ? "true" : "false"}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
          TONE_CLASS[tone],
        )}
      >
        <Icon size={12} />
        {sheet.periodClosed
          ? "Closed"
          : sheet.locked && sheet.status === "open"
            ? "Locked"
            : STATUS_LABEL[sheet.status]}
      </span>
      <span className="font-medium text-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-muted-foreground" data-testid="period-banner-detail">
        {detail}
      </span>
      {canSubmit && (
        <Button
          type="button"
          size="xs"
          onClick={() => setSubmitOpen(true)}
          disabled={busy}
          data-testid="sheet-submit"
        >
          <PaperPlaneTilt size={12} />
          {sheet.status === "rejected" ? "Submit again" : "Submit"}
        </Button>
      )}
      {canRecall && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setRecallOpen(true)}
          disabled={busy}
          data-testid="sheet-recall"
        >
          Recall
        </Button>
      )}
      <ReasonDialog
        isOpen={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onConfirm={(comment) => {
          setSubmitOpen(false);
          onSubmit(comment);
        }}
        title="Submit timesheet"
        description={`Send ${label} to your reviewer. ${formatMinutes(sheet.totalMinutes)} logged.`}
        reasonLabel="Note for your reviewer (optional)"
        reasonPlaceholder="Anything they should know"
        reasonRequired={false}
        confirmLabel="Submit"
        variant="default"
        loading={busy}
      />
      <ConfirmDialog
        isOpen={recallOpen}
        onClose={() => setRecallOpen(false)}
        onConfirm={() => {
          setRecallOpen(false);
          onRecall();
        }}
        title="Recall timesheet"
        message={`Take ${label} back from review so you can change it?`}
        confirmLabel="Recall"
        loading={busy}
      />
    </div>
  );
}
