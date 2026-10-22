import { useCallback, useEffect, useState } from "react";
import { Kanban, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { NumberInput } from "@/components/ui/number-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { friendlyErrorMessage } from "@/config";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { timeApi } from "@/features/projects/api/timeApi";
import { timePolicyLoaded } from "@/features/projects/store/timeSlice";
import type { TimePeriodType, TimePolicy } from "@/features/projects/types/time";

const ROUNDING_OPTIONS: SelectOption<number>[] = [1, 5, 6, 10, 15].map((minutes) => ({
  value: minutes,
  label: minutes === 1 ? "To the minute" : `${minutes} minutes`,
}));

const PERIOD_OPTIONS: SelectOption<TimePeriodType>[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const WEEK_START_OPTIONS: SelectOption<string>[] = [
  { value: "monday", label: "Monday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const MINUTES_PER_HOUR = 60;
const MAX_HOURS_PER_DAY = 24;
const MAX_LOCK_DELAY_DAYS = 30;
const MAX_MONTH_START_DAY = 28;
const MAX_TIMER_HOURS = 24;
const MAX_HOUR_UTC = 23;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseHolidays(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,;\s]+/)
        .map((token) => token.trim())
        .filter((token) => DATE_PATTERN.test(token)),
    ),
  ).sort();
}

export function TimePolicySection() {
  useDocumentTitle("Projects");
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const role = useAppSelector((state) => state.auth.currentOrganizationRole);
  const isAdmin = role === "OWNER" || role === "ADMIN";

  const [form, setForm] = useState<TimePolicy | null>(null);
  const [holidaysText, setHolidaysText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const policy = await timeApi.getTimePolicy(organizationId);
      setForm(policy);
      setHolidaysText(policy.holidays.join("\n"));
    } catch (err) {
      setError(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not load the time policy",
      );
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload]);

  const save = async () => {
    if (!organizationId || !form || saving) return;
    setSaving(true);
    try {
      const saved = await timeApi.updateTimePolicy(
        { ...form, holidays: parseHolidays(holidaysText) },
        organizationId,
      );
      setForm(saved);
      setHolidaysText(saved.holidays.join("\n"));
      dispatch(timePolicyLoaded(saved));
      toast.success("Time policy saved");
    } catch (err) {
      toast.error(
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
          "Could not save the time policy",
      );
    } finally {
      setSaving(false);
    }
  };

  const update = <K extends keyof TimePolicy>(key: K, value: TimePolicy[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const disabled = !isAdmin || saving;
  const approvalsOff = !form?.approvalsEnabled;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Kanban size={24} weight="duotone" className="shrink-0 text-primary" />
          <h1 className="text-xl font-bold md:text-2xl">Projects</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Time tracking rules for every project in this organization.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-surface p-4 shadow-edge">
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--status-error)" }}>
            <Warning size={20} weight="fill" />
            {error}
          </div>
        </div>
      )}

      {loading || !form ? (
        <div className="rounded-xl bg-surface p-6 text-sm text-muted-foreground shadow-edge">
          Loading...
        </div>
      ) : (
        <>
          <div
            className="divide-y divide-border rounded-xl bg-surface shadow-edge"
            data-testid="time-policy-tracking"
          >
            <Row
              title="Time tracking"
              description="Turn logging, timers, My time and the project time pages on or off. Time spent stays visible either way."
            >
              <ToggleSwitch
                enabled={form.enabled}
                onChange={(v) => update("enabled", v)}
                disabled={disabled}
                data-testid="policy-enabled"
              />
            </Row>
            <Row
              title="Required hours per workday"
              description="What a full day looks like on the week view and in reviews. Workdays come from each person's scheduling settings."
            >
              <NumberInput
                value={form.requiredMinutesPerDay / MINUTES_PER_HOUR}
                min={0}
                max={MAX_HOURS_PER_DAY}
                step={0.5}
                disabled={disabled}
                onChange={(e) => {
                  const hours = Number(e.target.value);
                  if (Number.isNaN(hours)) return;
                  update(
                    "requiredMinutesPerDay",
                    Math.round(Math.min(MAX_HOURS_PER_DAY, Math.max(0, hours)) * MINUTES_PER_HOUR),
                  );
                }}
                className="w-28"
                data-testid="policy-required-hours"
              />
            </Row>
            <Row
              title="Timer rounding"
              description="Timers round half up to this increment when they stop."
            >
              <Select
                value={form.timerRoundingMinutes}
                onChange={(v) => update("timerRoundingMinutes", v)}
                options={ROUNDING_OPTIONS}
                disabled={disabled}
                triggerClassName="w-44"
              />
            </Row>
            <Row
              title="Pause timers after"
              description="Hours a timer may run before the background job pauses it (1 to 24)."
            >
              <NumberInput
                value={form.maxTimerHours}
                min={1}
                max={MAX_TIMER_HOURS}
                disabled={disabled}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  if (!Number.isNaN(parsed)) {
                    update(
                      "maxTimerHours",
                      Math.min(MAX_TIMER_HOURS, Math.max(1, Math.round(parsed))),
                    );
                  }
                }}
                className="w-28"
              />
            </Row>
            <Row
              title="Allow future dates"
              description="Let people log time on days that have not happened yet."
            >
              <ToggleSwitch
                enabled={form.allowFutureDates}
                onChange={(v) => update("allowFutureDates", v)}
                disabled={disabled}
              />
            </Row>
            <Row
              title="Limit how far back"
              description="Days into the past a person may still log or change time. Off means until the day is locked."
            >
              <div className="flex items-center gap-3">
                <ToggleSwitch
                  enabled={form.maxDaysBack !== null}
                  onChange={(v) => update("maxDaysBack", v ? 14 : null)}
                  disabled={disabled}
                  data-testid="policy-days-back-toggle"
                />
                {form.maxDaysBack !== null && (
                  <NumberInput
                    value={form.maxDaysBack}
                    min={0}
                    max={365}
                    disabled={disabled}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        update("maxDaysBack", Math.min(365, Math.max(0, Math.round(parsed))));
                      }
                    }}
                    className="w-24"
                  />
                )}
              </div>
            </Row>
            <Row
              title="Log time for others"
              description="Reviewers and timekeeping admins may log on someone else's behalf; every such entry is audited."
            >
              <ToggleSwitch
                enabled={form.allowLogForOthers}
                onChange={(v) => update("allowLogForOthers", v)}
                disabled={disabled}
              />
            </Row>
          </div>

          <div
            className="divide-y divide-border rounded-xl bg-surface shadow-edge"
            data-testid="time-policy-approvals"
          >
            <Row
              title="Approvals"
              description="People submit each period and their manager or team lead approves it. Submitted and approved periods lock."
            >
              <ToggleSwitch
                enabled={form.approvalsEnabled}
                onChange={(v) => update("approvalsEnabled", v)}
                disabled={disabled}
                data-testid="policy-approvals"
              />
            </Row>
            <div className={cn("divide-y divide-border", approvalsOff && "opacity-50")}>
              <Row title="Period" description="How long one timesheet covers.">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Select
                    value={form.periodType}
                    onChange={(v) => update("periodType", v)}
                    options={PERIOD_OPTIONS}
                    disabled={disabled || approvalsOff}
                    triggerClassName="w-32"
                  />
                  {form.periodType === "weekly" ? (
                    <Select
                      value={form.weekStart}
                      onChange={(v) => update("weekStart", v)}
                      options={WEEK_START_OPTIONS}
                      disabled={disabled || approvalsOff}
                      triggerClassName="w-32"
                    />
                  ) : (
                    <NumberInput
                      value={form.monthStartDay}
                      min={1}
                      max={MAX_MONTH_START_DAY}
                      disabled={disabled || approvalsOff}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        if (!Number.isNaN(parsed)) {
                          update(
                            "monthStartDay",
                            Math.min(MAX_MONTH_START_DAY, Math.max(1, Math.round(parsed))),
                          );
                        }
                      }}
                      className="w-20"
                      title="Day of the month a period starts on"
                    />
                  )}
                </div>
              </Row>
              <Row
                title="Lock on submit"
                description="A submitted period refuses edits until it is recalled. Off: an edit recalls the period on its own."
              >
                <ToggleSwitch
                  enabled={form.lockOnSubmit}
                  onChange={(v) => update("lockOnSubmit", v)}
                  disabled={disabled || approvalsOff}
                />
              </Row>
              <Row
                title="Lock delay after a period ends"
                description="Days people have to finish a period before its open sheets lock (0 to 30). Auto-submit fires then too."
              >
                <NumberInput
                  value={form.periodLockDelayDays}
                  min={0}
                  max={MAX_LOCK_DELAY_DAYS}
                  disabled={disabled || approvalsOff}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    if (!Number.isNaN(parsed)) {
                      update(
                        "periodLockDelayDays",
                        Math.min(MAX_LOCK_DELAY_DAYS, Math.max(0, Math.round(parsed))),
                      );
                    }
                  }}
                  className="w-28"
                  data-testid="policy-lock-delay"
                />
              </Row>
              <Row
                title="Auto-submit"
                description="At the lock date, submit every open period that has entries and remind the rest."
              >
                <ToggleSwitch
                  enabled={form.autoSubmit}
                  onChange={(v) => update("autoSubmit", v)}
                  disabled={disabled || approvalsOff}
                />
              </Row>
              <Row
                title="Reminders"
                description="Remind people with an ended period they have not submitted, and reviewers with sheets waiting, once a day at this UTC hour."
              >
                <div className="flex items-center gap-3">
                  <ToggleSwitch
                    enabled={form.remindersEnabled}
                    onChange={(v) => update("remindersEnabled", v)}
                    disabled={disabled || approvalsOff}
                  />
                  <NumberInput
                    value={form.reminderHourUtc}
                    min={0}
                    max={MAX_HOUR_UTC}
                    disabled={disabled || approvalsOff || !form.remindersEnabled}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        update(
                          "reminderHourUtc",
                          Math.min(MAX_HOUR_UTC, Math.max(0, Math.round(parsed))),
                        );
                      }
                    }}
                    className="w-20"
                    title="Hour of the day in UTC"
                  />
                </div>
              </Row>
            </div>
            <div className="p-5">
              <h3 className="text-sm font-semibold text-foreground">Holidays</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Organization-wide days with no required hours, one YYYY-MM-DD date per line.
              </p>
              <Textarea
                value={holidaysText}
                onChange={(e) => setHolidaysText(e.target.value)}
                disabled={disabled}
                rows={4}
                className="mt-3 font-mono text-xs"
                placeholder="2026-12-25"
                data-testid="policy-holidays"
              />
            </div>
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={disabled || !form}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="policy-save"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        {!isAdmin && (
          <span className="text-xs text-muted-foreground">
            You need owner or admin role to change these settings.
          </span>
        )}
      </div>
    </div>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 p-5">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
