import { useEffect, useRef, useState } from "react";
import { PaperPlaneRight } from "@phosphor-icons/react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import {
  fetchRunnableSkills,
  type SerializedRunnableSkill,
} from "@/features/agents/store/agentRunnableSkillsThunks";
import {
  selectRunnableSkillsForAgent,
  selectRunnableSkillsStatus,
} from "@/features/agents/store/agentRunnableSkillsSlice";
import { fetchMessages, streamSendMessage } from "@/features/agents/store/agentMessagesThunks";
import { matchLeadingSkillCommand } from "@/features/agents/utils/slashCommands";

export function AgentTestComposer({
  agentId,
  sessionId,
  isBuilder,
  isStreaming,
}: {
  agentId: string;
  sessionId: string | null;
  isBuilder: boolean;
  isStreaming: boolean;
}) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const skills = useAppSelector(selectRunnableSkillsForAgent(agentId, "session"));
  const status = useAppSelector(selectRunnableSkillsStatus(agentId, "session"));
  const [content, setContent] = useState("");
  const [selected, setSelected] = useState<SerializedRunnableSkill | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const draftRevision = useRef(0);
  const [editorKey, setEditorKey] = useState(0);
  const disabled = sending || isStreaming || !sessionId;

  useEffect(() => {
    if (!isBuilder && organizationId) {
      dispatch(fetchRunnableSkills({ organizationId, agentId, surface: "session" }));
    }
  }, [dispatch, organizationId, agentId, isBuilder]);

  const send = async () => {
    if (disabled || !sessionId || sendingRef.current) return;
    const command =
      !isBuilder && !selected ? matchLeadingSkillCommand(content.trim(), skills) : null;
    const skill = isBuilder ? null : (selected ?? command?.skill);
    const body = command ? command.rest : content.trim();
    if (!body && !skill) return;
    sendingRef.current = true;
    const sentRevision = draftRevision.current;
    setSending(true);
    try {
      const result = await dispatch(
        streamSendMessage({
          sessionId,
          content: body,
          invokedSkillId: skill?.id,
          invokedSkillName: skill?.name,
        }),
      );
      if (streamSendMessage.fulfilled.match(result) && result.payload === "done") {
        if (draftRevision.current === sentRevision) {
          setContent("");
          setSelected(null);
          setEditorKey((key) => key + 1);
        }
      } else {
        dispatch(fetchMessages({ sessionId }));
        if (!isBuilder && organizationId) {
          dispatch(fetchRunnableSkills({ organizationId, agentId, surface: "session" }));
        }
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const unavailable = selected && !skills.some((skill) => skill.id === selected.id);
  const options = [
    { value: "", label: "No skill" },
    ...skills.map((skill) => ({ value: skill.id, label: `/${skill.name}` })),
    ...(unavailable ? [{ value: selected.id, label: `/${selected.name} (unavailable)` }] : []),
  ];

  return (
    <div className="border-t border-border bg-card px-3 py-2.5 shrink-0">
      {!isBuilder && (
        <div className="mb-2 space-y-1">
          <Select
            ariaLabel="Skill for this test"
            value={selected?.id ?? ""}
            options={options}
            onChange={(id) => setSelected(skills.find((skill) => skill.id === id) ?? null)}
            disabled={disabled || status === "loading"}
            size="sm"
            triggerClassName="min-h-11"
          />
          <p className="text-xs text-muted-foreground" role="status">
            {status === "loading"
              ? "Loading compatible skills..."
              : status === "failed"
                ? "Skills could not be loaded. Reopen the test to retry."
                : unavailable
                  ? "This skill is no longer available. Choose another skill or ask a builder to check its requirements."
                  : selected?.description ||
                    "Select a skill for this turn, or type /name. Only compatible assigned skills appear."}
          </p>
        </div>
      )}
      <div
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            void send();
          }
        }}
      >
        <ExpandableEditor
          key={editorKey}
          contentType={ContentType.AGENT}
          contentId={agentId}
          value={content}
          onChange={(value) => {
            draftRevision.current += 1;
            setContent(value);
          }}
          placeholder={
            isBuilder ? "Describe what your agent should do..." : "Send a test message..."
          }
          enableUpload={false}
          readonly={disabled}
          label={isBuilder ? "Prompt Builder message" : "Test message"}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground px-1">
          {!isBuilder && "Test session: hidden from conversations, memory writes disabled."}
        </p>
        <Button
          onClick={() => void send()}
          disabled={disabled || (!content.trim() && !selected)}
          size="sm"
          className="min-h-11 min-w-11"
          aria-label="Send test message"
        >
          <PaperPlaneRight size={14} />
        </Button>
      </div>
    </div>
  );
}
