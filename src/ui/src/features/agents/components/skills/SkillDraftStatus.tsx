import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleNotch } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { useAgentsBuilderAccess } from "@/features/agents/hooks/useAgentsBuilderAccess";
import { selectDraftById } from "@/features/agents/store/agentSkillDraftsSlice";
import {
  fetchSkillDraft,
  retrySkillDraftGeneration,
} from "@/features/agents/store/agentSkillDraftsThunks";

interface SkillDraftStatusProps {
  draftId: string;
  status: string;
  ownerId: string;
  generationAttempt: number;
  generationError: string;
}

export function SkillDraftStatus(props: SkillDraftStatusProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const cached = useAppSelector(selectDraftById(props.draftId));
  const { isBuilder } = useAgentsBuilderAccess();
  const [retrying, setRetrying] = useState(false);
  const draft =
    cached &&
    (cached.generationAttempt > props.generationAttempt ||
      props.status === "generating" ||
      cached.status === "saved" ||
      cached.status === "discarded")
      ? cached
      : props;
  const isRequester = currentUserId === props.ownerId;

  useEffect(() => {
    if (draft.status !== "generating" || (!isRequester && !isBuilder)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const result = await dispatch(fetchSkillDraft(props.draftId));
      if (
        !cancelled &&
        fetchSkillDraft.fulfilled.match(result) &&
        result.payload.status === "generating"
      ) {
        timer = setTimeout(poll, 2500);
      }
    };
    timer = setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dispatch, props.draftId, draft.status, isRequester, isBuilder, organizationId]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    await dispatch(
      retrySkillDraftGeneration({
        draftId: props.draftId,
        expectedAttempt: draft.generationAttempt,
      }),
    );
    setRetrying(false);
  };

  if (draft.status === "generating") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleNotch size={16} className="animate-spin" />
        Generating skill draft...
      </p>
    );
  }
  if (draft.status === "generation_failed") {
    return (
      <div className="space-y-2">
        <p role="status" className="text-sm text-muted-foreground">
          {friendlyErrorMessage("skill_generation_" + draft.generationError)}
        </p>
        {isRequester ? (
          <Button variant="secondary" className="min-h-11" onClick={retry} disabled={retrying}>
            {retrying ? "Retrying..." : "Retry generation"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">The requester can retry generation.</p>
        )}
      </div>
    );
  }
  if (draft.status === "pending") {
    return isBuilder ? (
      <Button
        className="min-h-11"
        onClick={() => navigate("/agents/skills/drafts/" + props.draftId)}
      >
        Review and save
      </Button>
    ) : (
      <p className="text-sm text-muted-foreground">Waiting for a builder to review.</p>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {draft.status === "saved" ? "Saved to skills" : "Discarded"}
    </p>
  );
}
