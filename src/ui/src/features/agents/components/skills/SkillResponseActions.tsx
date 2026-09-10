import { ActionMenuItem } from "@/components/ui/action-menu";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { Lightning, Sparkle } from "@phosphor-icons/react";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import { selectDraftById } from "@/features/agents/store/agentSkillDraftsSlice";
import { GenerateSkillDraftDialog } from "@/features/agents/components/skills/GenerateSkillDraftDialog";
import { SkillDraftStatus } from "@/features/agents/components/skills/SkillDraftStatus";

export type SkillResponseAction = "create" | "improve";

interface SkillResponseActionsProps {
  agentId: string;
  responseMessageId: string;
  triggerMessageId?: string;
  sessionId?: string;
  channelId?: string;
  threadRootId?: string;
  attribution: Record<string, unknown>;
  action: SkillResponseAction | null;
  onClose: () => void;
}

function responseDetails(props: {
  attribution: Record<string, unknown>;
  triggerMessageId?: string;
}) {
  const value = (key: string) =>
    typeof props.attribution[key] === "string" ? String(props.attribution[key]) : "";

  return {
    invocationId: value("skill_invocation_id"),
    triggerId: value("skill_trigger_message_id") || props.triggerMessageId,
    skillId: value("skill_id"),
    skillLabel: value("skill_display_name") + " v" + value("skill_version_number"),
    actorId: value("skill_actor_user_id"),
  };
}

export function SkillResponseMenuItems({
  attribution,
  triggerMessageId,
  onSelect,
}: {
  attribution: Record<string, unknown>;
  triggerMessageId?: string;
  onSelect: (action: SkillResponseAction) => void;
}) {
  const userId = useAppSelector((state) => state.auth.user?.id);
  const { invocationId, triggerId, actorId } = responseDetails({ attribution, triggerMessageId });
  const canImprove = invocationId && triggerId && actorId === userId;

  return (
    <>
      <ActionMenuItem type="button" role="menuitem" onClick={() => onSelect("create")}>
        <Lightning size={16} className="shrink-0" />
        <span>Create skill from conversation</span>
      </ActionMenuItem>
      {canImprove && (
        <ActionMenuItem type="button" role="menuitem" onClick={() => onSelect("improve")}>
          <Sparkle size={16} className="shrink-0" />
          <span>Improve this skill</span>
        </ActionMenuItem>
      )}
    </>
  );
}

export function SkillResponseActions(props: SkillResponseActionsProps) {
  const { isBuilder } = useAgentsBuilderAccess();
  const [draftId, setDraftId] = useState("");
  const draft = useAppSelector(selectDraftById(draftId));
  const { invocationId, triggerId, skillId, skillLabel } = responseDetails(props);
  const evidenceMessageIds = [
    ...new Set([triggerId, props.responseMessageId].filter((id): id is string => Boolean(id))),
  ];

  return (
    <>
      {invocationId && (
        <div className="mt-1 text-xs text-muted-foreground">
          {isBuilder ? (
            <Link
              className="focus-ring rounded px-1 py-3 hover:text-foreground"
              to={"/agents/skills/" + skillId}
            >
              Used {skillLabel}
            </Link>
          ) : (
            <span>Used {skillLabel}</span>
          )}
        </div>
      )}
      {draft && props.sessionId && <SkillDraftStatus {...draft} draftId={draft.id} />}
      {props.action && (
        <GenerateSkillDraftDialog
          evidence={{
            agentId: props.agentId,
            sessionId: props.sessionId,
            channelId: props.channelId,
            threadRootId: props.threadRootId,
            evidenceMessageIds,
            invocationId: props.action === "improve" ? invocationId : undefined,
          }}
          skillLabel={props.action === "improve" ? skillLabel : undefined}
          onClose={props.onClose}
          onCreated={setDraftId}
        />
      )}
    </>
  );
}
