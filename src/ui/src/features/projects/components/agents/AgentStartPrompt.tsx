import { useState } from "react";
import { CalendarBlank, HandPalm, Play } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { OptionTile } from "@/components/ui/option-tile";
import { TimeSelect } from "@/features/calendar/components/modals/TimeSelect";
import { instantFromDisplayParts } from "@/features/calendar/utils/dateUtils";
import { assignTaskAgent } from "@/features/projects/store/taskAgentsThunks";
import { closeAgentStartPrompt } from "@/features/projects/store/taskAgentsSlice";
import type { AgentRunStart } from "@/features/projects/types/project";
import { formatInTimeZone } from "date-fns-tz";
import { effectiveDayKey } from "@/shared/utils/dateFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";

type StartChoice = AgentRunStart["kind"];

function nextFullHour(): { day: string; hours: number } {
  const hour = 60 * 60 * 1000;
  const next = new Date(Math.ceil((Date.now() + 1) / hour) * hour);
  // Day and hour on the clock the user reads, which may differ from the device clock.
  return {
    day: effectiveDayKey(next),
    hours: Number(formatInTimeZone(next, getEffectiveTimeZone(), "H")),
  };
}

/** Asks when a newly picked agent starts on the task: now, on Start, or at a set time. */
export function AgentStartPrompt() {
  const target = useAppSelector((state) => state.taskAgents.startPrompt);
  if (!target) return null;
  return <AgentStartDialog key={`${target.taskId}:${target.agentId}`} {...target} />;
}

function AgentStartDialog({ taskId, agentId }: { taskId: string; agentId: string }) {
  const dispatch = useAppDispatch();
  const agentName = useAppSelector(
    (state) => state.taskAgents.list.agents.find((agent) => agent.id === agentId)?.name,
  );
  const taskTitle = useAppSelector((state) => state.projects.tasks[taskId]?.title);
  const [choice, setChoice] = useState<StartChoice>("now");
  const [{ day, hours }, setWhen] = useState(nextFullHour);
  const [isSaving, setIsSaving] = useState(false);
  const [openedAt] = useState(() => Date.now());

  const at = instantFromDisplayParts(day, Math.floor(hours), Math.round((hours % 1) * 60));
  // The dialog's opening time; submit checks the clock again and the server is the gate.
  const atInPast = choice === "at" && at.getTime() <= openedAt;
  const close = () => dispatch(closeAgentStartPrompt());

  const submit = async () => {
    if (isSaving || atInPast || (choice === "at" && at.getTime() <= Date.now())) return;
    const start: AgentRunStart = choice === "at" ? { kind: "at", at } : { kind: choice };
    setIsSaving(true);
    const result = await dispatch(assignTaskAgent({ taskId, agentId, start }));
    setIsSaving(false);
    if (assignTaskAgent.fulfilled.match(result)) close();
  };

  return (
    <Modal onClose={close} maxWidth="max-w-md" closeDisabled={isSaving}>
      <ModalHeader
        title={`Hand this task to ${agentName ?? "the agent"}`}
        description={taskTitle}
      />
      <ModalBody>
        <div
          role="radiogroup"
          aria-label="When the agent starts"
          className="grid gap-2"
          data-testid="agent-start-options"
        >
          <OptionTile
            selected={choice === "now"}
            icon={<Play size={16} />}
            label="Start now"
            description="The agent starts working on the task right away."
            onSelect={() => setChoice("now")}
          />
          <OptionTile
            selected={choice === "wait"}
            icon={<HandPalm size={16} />}
            label="Start later"
            description="Assign it now and press Start on the task when it is ready."
            onSelect={() => setChoice("wait")}
          />
          <OptionTile
            selected={choice === "at"}
            icon={<CalendarBlank size={16} />}
            label="Start at a set time"
            description="The agent starts on its own at the time you pick."
            onSelect={() => setChoice("at")}
          />
        </div>
        {choice === "at" && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <DatePicker value={day} onChange={(value) => setWhen({ day: value, hours })} />
            <TimeSelect
              value={hours}
              onChange={(value) => setWhen({ day, hours: value })}
              ariaLabel="Start time"
            />
            {atInPast && (
              <p className="w-full text-xs text-destructive">Pick a time in the future.</p>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={close} disabled={isSaving}>
          Cancel
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={atInPast}
          loading={isSaving}
          data-testid="agent-start-confirm"
        >
          {choice === "now" ? "Assign and start" : "Assign"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
