import { useMemo, useState } from "react";
import { CheckCircle, HourglassHigh, Lock, PaperPlaneTilt, XCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

interface PeriodStatusProps {
  sheet: Timesheet;
  busy: boolean;
  onSubmit: (comment: string, reviewerUserId?: string) => void;
  onRecall: () => void;
}

/** Sends the period to one reviewer, picked when the person has several. */
function SubmitDialog({
  sheet,
  label,
  busy,
  onClose,
  onSubmit,
}: {
  sheet: Timesheet;
  label: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (comment: string, reviewerUserId?: string) => void;
}) {
  const reviewerIds = sheet.reviewerUserIds;
  const { subjects } = useSubjectResolver(reviewerIds);
  const [reviewerId, setReviewerId] = useState(reviewerIds[0] ?? "");
  const [comment, setComment] = useState("");
  const options = subjects.map((subject) => ({
    value: subject.id,
    label: subject.name,
    icon: <SubjectAvatar subject={subject} size="xs" />,
  }));
  const chosen = subjects.find((subject) => subject.id === reviewerId);

  return (
    <Modal onClose={onClose} maxWidth="max-w-md" ariaLabel="Submit timesheet">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(comment.trim(), reviewerId || undefined);
        }}
      >
        <ModalHeader
          title="Submit timesheet"
          description={`Send ${label} for review. ${formatMinutes(sheet.totalMinutes)} of ${formatMinutes(sheet.requiredMinutes)} logged.`}
        />
        <ModalBody>
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-sm text-muted-foreground">Reviewer</div>
              {reviewerIds.length > 1 ? (
                <Select
                  value={reviewerId}
                  onChange={setReviewerId}
                  options={options}
                  ariaLabel="Reviewer"
                  triggerClassName="w-full"
                />
              ) : chosen ? (
                <div className="flex items-center gap-2 text-sm" data-testid="submit-reviewer">
                  <SubjectAvatar subject={chosen} size="xs" />
                  {chosen.name}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nobody is named as your reviewer, so the organization admins review it.
                </p>
              )}
              {reviewerIds.length > 1 && (
                <p className="mt-1 text-xs text-subtle-foreground">
                  Only the reviewer you pick is notified. Your other reviewers can still see it.
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground" htmlFor="submit-note">
                Note for your reviewer (optional)
              </label>
              <Textarea
                id="submit-note"
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Anything they should know"
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy} data-testid="submit-confirm">
            Submit
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/**
 * One period of the person's own time, compact enough for the page header: its state, what
 * was logged against what is expected, and the Submit or Recall action. The longer
 * explanation (a reviewer's reason, a lock, a grace window) rides on the state chip's tooltip.
 */
export function PeriodStatus({ sheet, busy, onSubmit, onRecall }: PeriodStatusProps) {
  const [submitOpen, setSubmitOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);
  const grace = graceActive(sheet);
  const label = periodLabel(sheet);
  const sentToIds = useMemo(
    () => (sheet.submittedToUserId ? [sheet.submittedToUserId] : []),
    [sheet.submittedToUserId],
  );
  const sentTo = useSubjectResolver(sentToIds).subjects[0]?.name;

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
    if (sheet.locked)
      detail += " Its entries are locked; ask your reviewer for grace to change them.";
  } else if (sheet.status === "submitted") {
    Icon = PaperPlaneTilt;
    const by = sentTo ? ` by ${sentTo}` : "";
    detail = sheet.submittedAt
      ? `Waiting for review${by} since ${formatDateShort(sheet.submittedAt)}.`
      : `Waiting for review${by}.`;
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
    detail = "Open. Submit it to your reviewer when the period is done.";
  }
  if (grace && sheet.graceUntil) {
    detail += ` Open for edits ${formatTimeRemaining(sheet.graceUntil)}.`;
  }

  const canSubmit =
    !sheet.periodClosed &&
    (sheet.status === "open" || sheet.status === "rejected") &&
    (!sheet.locked || grace);
  const canRecall = !sheet.periodClosed && sheet.status === "submitted";
  const stateLabel = sheet.periodClosed
    ? "Closed"
    : sheet.locked && sheet.status === "open"
      ? "Locked"
      : STATUS_LABEL[sheet.status];

  return (
    <div
      className="flex items-center gap-2 text-xs"
      data-testid="period-banner"
      data-status={sheet.periodClosed ? "closed" : sheet.status}
      data-locked={sheet.locked ? "true" : "false"}
    >
      <span
        className={cn(
          "inline-flex h-6 cursor-default items-center gap-1 rounded-full px-2 font-medium",
          TONE_CLASS[tone],
        )}
        title={`${label}. ${detail}`}
      >
        <Icon size={12} />
        {stateLabel}
      </span>
      <span className="sr-only" data-testid="period-banner-detail">
        {detail}
      </span>
      <span className="tabular-nums" data-testid="week-total" title={`Logged in ${label}`}>
        <span className="font-semibold text-foreground">{formatMinutes(sheet.totalMinutes)}</span>
        {sheet.requiredMinutes > 0 && (
          <span className="text-muted-foreground"> / {formatMinutes(sheet.requiredMinutes)}</span>
        )}
      </span>
      {canSubmit && (
        <Button
          type="button"
          size="xs"
          variant="secondary"
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
      {submitOpen && (
        <SubmitDialog
          sheet={sheet}
          label={label}
          busy={busy}
          onClose={() => setSubmitOpen(false)}
          onSubmit={(comment, reviewerUserId) => {
            setSubmitOpen(false);
            onSubmit(comment, reviewerUserId);
          }}
        />
      )}
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
