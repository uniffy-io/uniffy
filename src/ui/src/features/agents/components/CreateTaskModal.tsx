import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleNotch, Plus, Robot } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { getBrowserTimeZone } from "@/shared/utils/timezone";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { createCronTask } from "@/features/agents/store/agentCronThunks";
import {
  DEFAULT_SCHEDULE,
  FREQUENCY_OPTIONS,
  HOUR_OPTIONS,
  MINUTE_INTERVAL_OPTIONS,
  MINUTE_OPTIONS,
  MONTH_DAY_OPTIONS,
  WEEKDAY_LABELS,
  cronToHuman,
  scheduleToCron,
} from "@/features/agents/utils/cronSchedule";
import type { Frequency, ScheduleConfig } from "@/features/agents/utils/cronSchedule";

function ScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleConfig;
  onChange: (config: ScheduleConfig) => void;
}) {
  const toggleWeekday = (day: number) => {
    const next = value.weekdays.includes(day)
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day];
    onChange({ ...value, weekdays: next });
  };

  const selectWeekdayPreset = (preset: "weekdays" | "everyday" | "weekends") => {
    const map = {
      weekdays: [1, 2, 3, 4, 5],
      everyday: [0, 1, 2, 3, 4, 5, 6],
      weekends: [0, 6],
    };
    onChange({ ...value, weekdays: map[preset] });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-muted-foreground mb-1">Repeat</label>
        <Select<string>
          value={value.frequency}
          onChange={(f) => onChange({ ...value, frequency: f as Frequency })}
          options={FREQUENCY_OPTIONS}
        />
      </div>

      {value.frequency === "minutes" && (
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Interval</label>
          <Select<number>
            value={value.minuteInterval}
            onChange={(v) => onChange({ ...value, minuteInterval: v })}
            options={MINUTE_INTERVAL_OPTIONS}
          />
        </div>
      )}

      {value.frequency !== "minutes" && (
        <div>
          <label className="block text-sm text-muted-foreground mb-1">
            {value.frequency === "hourly" ? "At minute" : "Time"}
          </label>
          {value.frequency === "hourly" ? (
            <Select<number>
              value={value.minute}
              onChange={(m) => onChange({ ...value, minute: m })}
              options={MINUTE_OPTIONS}
            />
          ) : (
            <div className="flex gap-2">
              <div className="flex-1">
                <Select<number>
                  value={value.hour}
                  onChange={(h) => onChange({ ...value, hour: h })}
                  options={HOUR_OPTIONS}
                />
              </div>
              <div className="w-24">
                <Select<number>
                  value={value.minute}
                  onChange={(m) => onChange({ ...value, minute: m })}
                  options={MINUTE_OPTIONS}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {value.frequency === "weekly" && (
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Days</label>
          <div className="flex gap-1 mb-2">
            {WEEKDAY_LABELS.map((label, i) => {
              const active = value.weekdays.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleWeekday(i)}
                  className={cn(
                    "flex-1 py-1.5 rounded-md text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => selectWeekdayPreset("weekdays")}
              className="text-xs text-primary hover:underline"
            >
              Weekdays
            </button>
            <button
              type="button"
              onClick={() => selectWeekdayPreset("weekends")}
              className="text-xs text-primary hover:underline"
            >
              Weekends
            </button>
            <button
              type="button"
              onClick={() => selectWeekdayPreset("everyday")}
              className="text-xs text-primary hover:underline"
            >
              Every day
            </button>
          </div>
        </div>
      )}

      {value.frequency === "monthly" && (
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Day of month</label>
          <Select<number>
            value={value.monthDay}
            onChange={(d) => onChange({ ...value, monthDay: d })}
            options={MONTH_DAY_OPTIONS}
          />
        </div>
      )}

      <div className="bg-muted/50 border border-border rounded-lg px-3 py-2">
        <span className="text-xs text-muted-foreground">Schedule: </span>
        <span className="text-sm font-medium text-foreground">
          {cronToHuman(scheduleToCron(value))}
        </span>
      </div>
    </div>
  );
}

function CreateTaskModalContent({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const agents = useAppSelector((state) => state.agents.agents);

  const agentOptions = useMemo(
    () => Object.values(agents).map((a) => ({ value: a.id, label: a.name })),
    [agents],
  );

  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE);
  // Derived until the user picks: a mount-time snapshot goes stale when the
  // settings fetch lands after the modal opens.
  const settingsTimezone = useAppSelector(
    (state) => state.settings.effectiveSettings?.appearance.timezone,
  );
  const [timezoneOverride, setTimezoneOverride] = useState<string | null>(null);
  const timezone = timezoneOverride ?? settingsTimezone ?? getBrowserTimeZone();
  const [submitting, setSubmitting] = useState(false);

  const effectiveAgentId = agentId || agentOptions[0]?.value || "";
  const cronExpression = scheduleToCron(schedule);
  const canSubmit =
    Boolean(effectiveAgentId) && Boolean(name.trim()) && Boolean(prompt.trim()) && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const task = await dispatch(
        createCronTask({
          agentId: effectiveAgentId,
          name: name.trim(),
          prompt: prompt.trim(),
          cronExpression,
          timezone,
        }),
      ).unwrap();
      navigate(`/agents/automations/${task.id}`);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (agentOptions.length === 0) {
    return (
      <>
        <ModalHeader title="New automation" />
        <ModalBody>
          <div className="flex flex-col items-center justify-center py-6">
            <Robot size={32} className="text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Create an agent first to schedule tasks</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <ModalHeader title="New automation" />

      <ModalBody>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Agent</label>
          <Select value={effectiveAgentId} onChange={setAgentId} options={agentOptions} />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Task name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily standup summary"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Prompt</label>
          <div className="border border-border rounded-lg overflow-hidden bg-muted">
            <CrepeEditor
              contentType={ContentType.AGENT}
              contentId={effectiveAgentId}
              value={prompt}
              onChange={setPrompt}
              enableUpload={false}
              compact
              minHeight="100px"
              placeholder="The instruction sent to the agent on each execution..."
            />
          </div>
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Schedule</h3>
          <ScheduleBuilder value={schedule} onChange={setSchedule} />
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Timezone</label>
          <TimezoneSelect value={timezone} onChange={setTimezoneOverride} allowAutomatic={false} />
        </div>
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          {submitting ? <CircleNotch size={16} className="animate-spin" /> : <Plus size={16} />}
          Create Task
        </Button>
      </ModalFooter>
    </form>
  );
}

export function CreateTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal onClose={onClose} maxWidth="max-w-xl">
      <CreateTaskModalContent onClose={onClose} />
    </Modal>
  );
}
