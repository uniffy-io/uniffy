import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Timer,
  Trash,
  Play,
  Clock,
  ClockCounterClockwise,
  CircleNotch,
  CheckCircle,
  Plus,
  Robot,
  XCircle,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  BrowseBody,
  BrowseCard,
  BrowseEmpty,
  BrowseGrid,
  BrowseHeader,
} from "@/features/agents/components/browse/BrowseSurface";
import { selectAllAgents, selectDeletedAgents } from "@/features/agents/store/agentsSlice";
import {
  selectCronTasksList,
  selectCronLoading,
  selectCronRunLogs,
} from "@/features/agents/store/agentCronSlice";
import {
  fetchCronTasks,
  updateCronTask,
  deleteCronTask,
  fetchCronRunLogs,
  triggerCronTask,
} from "@/features/agents/store/agentCronThunks";
import { cronToHuman } from "@/features/agents/utils/cronSchedule";
import type { SerializedCronTask } from "@/features/agents/store/agentCronThunks";

function protoTimestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
  if (!ts) return undefined;
  return new Date(ts.seconds * 1000).toISOString();
}

function TaskStatusBadge({ task }: { task: SerializedCronTask }) {
  if (!task.isEnabled && task.consecutiveFailures >= task.maxConsecutiveFailures) {
    return (
      <Badge variant="destructive" className="text-xs">
        Auto-disabled
      </Badge>
    );
  }
  if (!task.isEnabled) {
    return (
      <Badge variant="secondary" className="text-xs">
        Paused
      </Badge>
    );
  }
  return (
    <Badge variant="default" className="text-xs bg-green-600 dark:bg-green-700">
      Active
    </Badge>
  );
}

function TaskRunHistory({ taskId }: { taskId: string }) {
  const dispatch = useAppDispatch();
  const logs = useAppSelector(selectCronRunLogs(taskId));
  const [loaded, setLoaded] = useState(false);

  const hasPending = useMemo(() => logs.some((log) => log.status === "pending"), [logs]);

  useEffect(() => {
    dispatch(fetchCronRunLogs({ taskId }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loaded state when taskId changes
    setLoaded(true);
  }, [taskId, dispatch]);

  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => {
      dispatch(fetchCronRunLogs({ taskId }));
      dispatch(fetchCronTasks());
    }, 3000);
    return () => clearInterval(interval);
  }, [hasPending, taskId, dispatch]);

  if (!loaded) return null;

  if (logs.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No execution history yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <div
          key={log.id}
          className="flex items-start gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border"
        >
          <div className="pt-0.5">
            {log.status === "pending" ? (
              <CircleNotch size={16} className="animate-spin text-primary" />
            ) : log.status === "success" ? (
              <CheckCircle size={16} weight="fill" className="text-green-600 dark:text-green-400" />
            ) : (
              <XCircle size={16} weight="fill" className="text-red-500 dark:text-red-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{formatRelativeTime(protoTimestampToDateStr(log.startedAt))}</span>
              {log.status === "pending" ? (
                <span className="text-primary font-medium">Running...</span>
              ) : (
                <span>{log.inputTokens + log.outputTokens} tokens</span>
              )}
            </div>
            {log.error && (
              <p className="text-sm text-red-500 dark:text-red-400 mt-1 line-clamp-2">
                {log.error}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function TaskDetailPanel({
  task,
  onDelete,
  onBack,
}: {
  task: SerializedCronTask;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const dispatch = useAppDispatch();

  const handleToggle = async () => {
    setTogglingEnabled(true);
    try {
      await dispatch(
        updateCronTask({
          taskId: task.id,
          isEnabled: !task.isEnabled,
        }),
      ).unwrap();
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await dispatch(triggerCronTask(task.id)).unwrap();
      dispatch(fetchCronRunLogs({ taskId: task.id }));
    } finally {
      setTriggering(false);
    }
  };

  const scheduleLabel = cronToHuman(task.cronExpression);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/60 bg-card">
        <div className="flex items-center gap-3 px-4 pt-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            data-testid="automations-detail-back"
          >
            <ArrowLeft size={14} />
            All automations
          </button>
        </div>
        <div className="flex items-center gap-3 px-4 py-2">
          <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Timer size={18} className="text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-foreground truncate">{task.name}</h2>
            <p className="text-xs text-muted-foreground truncate">
              {scheduleLabel} ({task.timezone}){task.agentName && ` - ${task.agentName}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTrigger}
              disabled={triggering}
              title="Run now"
            >
              {triggering ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <Play size={14} weight="fill" />
              )}
              {triggering ? "Running..." : "Run Now"}
            </Button>
            <ToggleSwitch
              enabled={task.isEnabled}
              onChange={handleToggle}
              disabled={togglingEnabled}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-muted-foreground hover:text-red-500"
              aria-label="Delete task"
              title="Delete"
            >
              <Trash size={18} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <section className="border-b border-border px-6 py-5">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
            Task Details
          </h3>
          <div className="space-y-3 max-w-2xl">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <TaskStatusBadge task={task} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Schedule</span>
              <span className="text-sm text-foreground">{scheduleLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Timezone</span>
              <span className="text-sm text-foreground">{task.timezone}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Next Run</span>
              <span className="text-sm text-foreground">
                {task.nextRunAt
                  ? formatRelativeTime(protoTimestampToDateStr(task.nextRunAt))
                  : "N/A"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Last Run</span>
              <span className="text-sm text-foreground">
                {task.lastRunAt
                  ? formatRelativeTime(protoTimestampToDateStr(task.lastRunAt))
                  : "Never"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Runs</span>
              <span className="text-sm text-foreground">{task.runCount}</span>
            </div>
            {task.consecutiveFailures > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Consecutive Failures</span>
                <Badge variant="destructive" className="text-xs">
                  {task.consecutiveFailures} / {task.maxConsecutiveFailures}
                </Badge>
              </div>
            )}
            {task.lastRunError && (
              <div className="mt-2 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                  Last Error
                </p>
                <p className="text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap break-words">
                  {task.lastRunError}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="border-b border-border px-6 py-5">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Prompt</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap max-w-2xl">
            {task.prompt}
          </p>
        </section>

        <section className="px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-muted-foreground" />
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
              Execution History
            </h3>
          </div>
          <div className="max-w-2xl">
            <TaskRunHistory taskId={task.id} />
          </div>
        </section>
      </div>
    </div>
  );
}

function AutomationCard({
  task,
  agentName,
  onOpen,
}: {
  task: SerializedCronTask;
  agentName: string;
  onOpen: () => void;
}) {
  const failed = !task.isEnabled && task.consecutiveFailures >= task.maxConsecutiveFailures;
  const nextRun =
    task.isEnabled && task.nextRunAt
      ? formatRelativeTime(protoTimestampToDateStr(task.nextRunAt))
      : null;

  return (
    <BrowseCard
      onOpen={onOpen}
      dimmed={!task.isEnabled}
      testId={`automations-card-${task.id}`}
      leading={
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            failed
              ? "bg-red-500/10 text-red-500"
              : task.isEnabled
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
          )}
        >
          <ClockCounterClockwise size={18} weight="duotone" />
        </span>
      }
      title={task.name}
      subtitle={task.prompt}
      badges={<TaskStatusBadge task={task} />}
      chips={
        <>
          <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
            <Clock size={10} />
            {cronToHuman(task.cronExpression)}
          </Badge>
          <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
            <Robot size={10} />
            {agentName}
          </Badge>
          {nextRun && <span className="text-[10px] text-muted-foreground">next {nextRun}</span>}
        </>
      }
    />
  );
}

function AutomationsBrowse({
  tasks,
  onNewAutomation,
}: {
  tasks: SerializedCronTask[];
  onNewAutomation: () => void;
}) {
  const navigate = useNavigate();
  const agentsMap = useAppSelector(selectAllAgents);
  const deletedAgentsMap = useAppSelector(selectDeletedAgents);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const visible = tasks.filter((task) => !query || task.name.toLowerCase().includes(query));
  const agentName = (agentId: string) =>
    agentsMap[agentId]?.name ?? deletedAgentsMap[agentId]?.name ?? "Unknown agent";

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="automations-browse">
      <BrowseHeader
        title="Automations"
        subtitle="An agent runs a prompt you define on a recurring schedule."
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search automations..."
        testId="automations-browse-header"
        action={
          <Button onClick={onNewAutomation} data-testid="automations-new-button">
            <Plus size={16} />
            New automation
          </Button>
        }
      />
      <BrowseBody testId="automations-browse-body">
        {visible.length === 0 ? (
          <BrowseEmpty
            icon={Timer}
            title={query ? "No match" : "No automations yet"}
            description={
              query
                ? `No automation matches "${search.trim()}".`
                : "Schedule an agent to run a prompt on its own, on the cadence you pick."
            }
            testId="automations-browse-empty"
          />
        ) : (
          <BrowseGrid>
            {visible.map((task) => (
              <AutomationCard
                key={task.id}
                task={task}
                agentName={agentName(task.agentId)}
                onOpen={() => navigate(`/agents/automations/${task.id}`)}
              />
            ))}
          </BrowseGrid>
        )}
      </BrowseBody>
    </div>
  );
}

export function AutomationsView({ onNewAutomation }: { onNewAutomation: () => void }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { subId } = useParams<{ tab?: string; subId?: string }>();
  const tasks = useAppSelector(selectCronTasksList);
  const loading = useAppSelector(selectCronLoading);

  const selectedTask = useMemo(
    () => (subId ? (tasks.find((t) => t.id === subId) ?? null) : null),
    [subId, tasks],
  );

  const handleDelete = async (taskId: string) => {
    await dispatch(deleteCronTask(taskId)).unwrap();
    navigate("/agents/automations", { replace: true });
  };

  if (loading && tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <CircleNotch size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!selectedTask) {
    return <AutomationsBrowse tasks={tasks} onNewAutomation={onNewAutomation} />;
  }

  return (
    <TaskDetailPanel
      task={selectedTask}
      onDelete={() => handleDelete(selectedTask.id)}
      onBack={() => navigate("/agents/automations")}
    />
  );
}
