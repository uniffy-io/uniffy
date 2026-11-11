import { useEffect, useMemo } from "react";
import { Robot } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Select, type SelectOption } from "@/components/ui/select";
import { SUBJECT_TYPE, SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import {
  fetchTaskAgents,
  setProjectAgentAssignee,
} from "@/features/projects/store/taskAgentsThunks";
import { roleCanManage } from "@/shared/utils/contentRoles";
import type { Project } from "@/features/projects/types";

/** Project admins pick the agent that picks up every new task in the project. */
export function AgentAssigneeSection({ project }: { project: Project }) {
  const dispatch = useAppDispatch();
  const canManage = roleCanManage(project.userRole);
  const agents = useAppSelector((state) => state.taskAgents.list.agents);
  const assignmentEnabled = useAppSelector((state) => state.taskAgents.policy.enabled);
  const agentId = project.agentAssigneeId ?? null;
  const { subjects } = useSubjectResolver(
    project.agentAssigneeSetById ? [project.agentAssigneeSetById] : [],
    [],
  );

  useEffect(() => {
    dispatch(fetchTaskAgents());
  }, [dispatch]);

  const options = useMemo<SelectOption<string>[]>(
    () =>
      agents.map((agent) => ({
        value: agent.id,
        label: agent.name,
        icon: (
          <SubjectAvatar
            subject={{
              id: agent.id,
              type: SUBJECT_TYPE.AGENT,
              name: agent.name,
              avatarEmoji: agent.avatarEmoji ?? undefined,
            }}
            size="xs"
          />
        ),
      })),
    [agents],
  );
  const agentKnown = agentId ? options.some((option) => option.value === agentId) : true;

  return (
    <div className="space-y-8" data-testid="project-agent-assignee">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Robot size={24} weight="duotone" className="text-primary shrink-0" />
          Agent Assignee
        </h1>
        <p className="text-muted-foreground">
          New tasks created in this project are picked up by this agent. It works with the
          permissions of the person who created each task, so it can only reach what they can, and
          that person can decline it when creating the task. Tasks that already exist are left
          alone.
        </p>
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-edge md:p-6 space-y-3">
        {!assignmentEnabled ? (
          <p className="text-sm text-muted-foreground">
            Assigning tasks to agents is turned off for this organization.
          </p>
        ) : (
          <>
            <div className="max-w-sm" data-testid="project-agent-assignee-select">
              <Select<string>
                value={agentId && agentKnown ? agentId : undefined}
                onChange={(next) =>
                  void dispatch(setProjectAgentAssignee({ projectId: project.id, agentId: next }))
                }
                options={options}
                placeholder={
                  agentId && !agentKnown ? "An agent you cannot use" : "No agent picks up new tasks"
                }
                disabled={!canManage}
                ariaLabel="Agent assignee"
                searchable={options.length > 8}
                searchPlaceholder="Search agents..."
              />
            </div>
            {agentId && subjects[0] && (
              <p className="text-xs text-subtle-foreground">Chosen by {subjects[0].name}</p>
            )}
            {agentId && canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 md:min-h-0"
                onClick={() =>
                  void dispatch(setProjectAgentAssignee({ projectId: project.id, agentId: null }))
                }
                data-testid="project-agent-assignee-clear"
              >
                Stop picking up new tasks
              </Button>
            )}
            {!canManage && (
              <p className="text-xs text-subtle-foreground">Only project admins can change this.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
