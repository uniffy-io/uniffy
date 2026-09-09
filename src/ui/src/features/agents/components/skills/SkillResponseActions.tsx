import { useState } from "react";
import { Link } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import { selectDraftById } from "@/features/agents/store/agentSkillDraftsSlice";
import { GenerateSkillDraftDialog } from "@/features/agents/components/skills/GenerateSkillDraftDialog";
import { SkillDraftStatus } from "@/features/agents/components/skills/SkillDraftStatus";

interface SkillResponseActionsProps {
  agentId: string;
  responseMessageId: string;
  triggerMessageId?: string;
  sessionId?: string;
  channelId?: string;
  threadRootId?: string;
  attribution: Record<string, unknown>;
}

export function SkillResponseActions(props: SkillResponseActionsProps) {
  const userId = useAppSelector((state) => state.auth.user?.id);
  const { isBuilder } = useAgentsBuilderAccess();
  const [action, setAction] = useState<"create" | "improve" | null>(null);
  const [draftId, setDraftId] = useState("");
  const draft = useAppSelector(selectDraftById(draftId));
  const value = (key: string) =>
    typeof props.attribution[key] === "string" ? String(props.attribution[key]) : "";
  const invocationId = value("skill_invocation_id");
  const triggerId = value("skill_trigger_message_id") || props.triggerMessageId;
  const skillId = value("skill_id");
  const skillLabel = value("skill_display_name") + " v" + value("skill_version_number");
  const canImprove = invocationId && triggerId && value("skill_actor_user_id") === userId;
  const evidenceMessageIds = [
    ...new Set([triggerId, props.responseMessageId].filter((id): id is string => Boolean(id))),
  ];

  return (
    <div className="mt-1 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {invocationId &&
          (isBuilder ? (
            <Link
              className="focus-ring rounded px-1 py-3 hover:text-foreground"
              to={"/agents/skills/" + skillId}
            >
              Used {skillLabel}
            </Link>
          ) : (
            <span>Used {skillLabel}</span>
          ))}
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 text-xs"
          onClick={() => setAction("create")}
        >
          Create skill from conversation
        </Button>
        {canImprove && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 text-xs"
            onClick={() => setAction("improve")}
          >
            Improve this skill
          </Button>
        )}
      </div>
      {draft && props.sessionId && <SkillDraftStatus {...draft} draftId={draft.id} />}
      {action && (
        <GenerateSkillDraftDialog
          evidence={{
            agentId: props.agentId,
            sessionId: props.sessionId,
            channelId: props.channelId,
            threadRootId: props.threadRootId,
            evidenceMessageIds,
            invocationId: action === "improve" ? invocationId : undefined,
          }}
          skillLabel={action === "improve" ? skillLabel : undefined}
          onClose={() => setAction(null)}
          onCreated={setDraftId}
        />
      )}
    </div>
  );
}
