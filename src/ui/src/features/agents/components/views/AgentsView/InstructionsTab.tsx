import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleNotch,
  Eye,
  ArrowClockwise,
  CaretDown,
  CaretRight,
  ChatCircleDots,
} from "@phosphor-icons/react";
import { useAppDispatch } from "@/app/hooks";
import { useMyContentRole } from "@/features/permissions";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { updateAgent, previewSystemPrompt } from "@/features/agents/store/agentsThunks";
import type { SerializedAgent } from "@/features/agents/store/agentsThunks";
import { AgentTestDrawer } from "@/features/agents/components/AgentTestDrawer";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Button } from "@/components/ui/button";

function AssembledPromptPreview({ agent }: { agent: SerializedAgent }) {
  const dispatch = useAppDispatch();
  const [expanded, setExpanded] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const promptFingerprint = useMemo(
    () =>
      [
        agent.id,
        agent.soulPrompt,
        agent.name,
        agent.enabledTools.join(","),
        agent.enabledSkills.join(","),
      ].join("|"),
    [agent.id, agent.soulPrompt, agent.name, agent.enabledTools, agent.enabledSkills],
  );

  useEffect(() => {
    if (!expanded) return;

    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(() => {
      setLoading(true);
      dispatch(previewSystemPrompt(agent.id))
        .unwrap()
        .then((text) => setPromptText(text))
        .finally(() => setLoading(false));
    }, 500);

    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    };
  }, [promptFingerprint, expanded, agent.id, dispatch]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleRefresh = useCallback(() => {
    setLoading(true);
    dispatch(previewSystemPrompt(agent.id))
      .unwrap()
      .then((text) => setPromptText(text))
      .finally(() => setLoading(false));
  }, [agent.id, dispatch]);

  return (
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
        <Eye size={16} />
        <span className="font-medium">Assembled prompt preview</span>
        {promptText !== null && (
          <span className="text-xs text-muted-foreground ml-1">
            ({promptText.length.toLocaleString()} chars)
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Preview of the full prompt sent to the LLM. The platform automatically appends agent
              metadata, enabled tools, active skills, user memories, and the workspace guidelines to
              your custom instructions.
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loading ? (
                <CircleNotch size={14} className="animate-spin" />
              ) : (
                <ArrowClockwise size={14} />
              )}
              Refresh
            </button>
          </div>
          {loading && promptText === null ? (
            <div className="flex items-center justify-center py-8">
              <CircleNotch size={24} className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden bg-muted/50">
              <CrepeEditor
                contentType={ContentType.AGENT}
                contentId={agent.id}
                value={promptText ?? ""}
                readonly
                enableUpload={false}
                compact
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SoulPromptEditor({ agent, canEdit }: { agent: SerializedAgent; canEdit: boolean }) {
  const dispatch = useAppDispatch();
  const [localValue, setLocalValue] = useState(agent.soulPrompt);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The editor holds a debounced draft, so it resyncs when the stored prompt changes.
    // eslint-disable-next-line react/react-compiler
    setLocalValue(agent.soulPrompt);
  }, [agent.id, agent.soulPrompt]);

  const handleChange = useCallback(
    (markdown: string) => {
      setLocalValue(markdown);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        dispatch(updateAgent({ agentId: agent.id, soulPrompt: markdown }));
      }, 800);
    },
    [agent.id, dispatch],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return (
    <CrepeEditor
      contentType={ContentType.AGENT}
      contentId={agent.id}
      value={localValue}
      onChange={canEdit ? handleChange : undefined}
      readonly={!canEdit}
      enableUpload={false}
      compact
      minHeight="200px"
      placeholder="Write your agent's personality, instructions, and behavioral guidelines here... (markdown supported)"
    />
  );
}

export function InstructionsTab({ agent }: { agent: SerializedAgent }) {
  const myRole = useMyContentRole(ContentType.AGENT, agent.id, agent.userRole);
  // A deleted agent is a historical record: readable, never editable.
  const canEdit = roleCanEdit(myRole) && !agent.isDeleted;
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto divide-y divide-border animate-in fade-in duration-300">
          <section className="pb-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                  Custom Instructions
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Define your agent's personality, behavior, and guidelines. Placed at the top of
                  the system prompt.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDrawerOpen(true)}
                className="gap-1.5"
              >
                <ChatCircleDots size={14} weight="duotone" />
                AI Builder
              </Button>
            </div>
            <div className="border border-border rounded-lg overflow-hidden bg-muted/30">
              <SoulPromptEditor agent={agent} canEdit={canEdit} />
            </div>
          </section>

          <section className="py-6">
            <AssembledPromptPreview agent={agent} />
          </section>
        </div>
      </div>

      <AgentTestDrawer
        agent={agent}
        mode="builder"
        canEdit={canEdit}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
