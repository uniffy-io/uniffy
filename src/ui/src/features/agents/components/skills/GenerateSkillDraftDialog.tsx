import { useId, useState } from "react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { randomUUID } from "@/shared/utils/uuid";
import {
  generateSkillDraft,
  type GenerateDraftFields,
} from "@/features/agents/store/agentSkillDraftsThunks";

export interface SkillDraftEvidence {
  agentId: string;
  sessionId?: string;
  channelId?: string;
  threadRootId?: string;
  evidenceMessageIds: string[];
  invocationId?: string;
}

interface GenerateSkillDraftDialogProps {
  evidence: SkillDraftEvidence;
  skillLabel?: string;
  onClose: () => void;
  onCreated: (draftId: string) => void;
}

export function GenerateSkillDraftDialog({
  evidence,
  skillLabel,
  onClose,
  onCreated,
}: GenerateSkillDraftDialogProps) {
  const dispatch = useAppDispatch();
  const rationaleId = useId();
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [request, setRequest] = useState<GenerateDraftFields | null>(null);

  const submit = async () => {
    if (submitting || !rationale.trim()) return;
    const fields = request ?? {
      ...evidence,
      rationale: rationale.trim(),
      requestId: randomUUID(),
    };
    setRequest(fields);
    setSubmitting(true);
    const result = await dispatch(generateSkillDraft(fields));
    setSubmitting(false);
    if (generateSkillDraft.fulfilled.match(result)) {
      onCreated(result.payload.id);
      onClose();
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting}>
      <ModalHeader
        title={evidence.invocationId ? "Improve this skill" : "Create skill from conversation"}
        description={skillLabel}
      />
      <ModalBody>
        <p className="text-sm text-muted-foreground">
          {evidence.evidenceMessageIds.length > 1
            ? "Use this reply and the message it answers as evidence."
            : "Use this reply as evidence."}{" "}
          The generated draft will be visible to your organization's builders for review. It becomes
          available only after a builder saves it.
        </p>
        <div>
          <label htmlFor={rationaleId} className="mb-1 block text-sm text-muted-foreground">
            {evidence.invocationId ? "What should improve?" : "What should the skill help with?"}
          </label>
          <Textarea
            id={rationaleId}
            value={rationale}
            disabled={submitting}
            onChange={(event) => {
              setRationale(event.target.value);
              setRequest(null);
            }}
            maxLength={2000}
            rows={5}
            autoFocus
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting || !rationale.trim()}>
          {submitting ? "Requesting..." : "Generate draft"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
