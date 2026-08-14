import { useState } from "react";
import { CaretDown, CheckCircle, CircleNotch, ClockCountdown } from "@phosphor-icons/react";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { cn } from "@/shared/utils/cn";

import {
  formatThinkingDuration,
  type ThinkingBlockView,
} from "@/features/agents/utils/thinkingBlocks";

export type { ThinkingBlockView };

interface ThinkingPaneProps {
  blocks: readonly ThinkingBlockView[];
  /** True while reasoning is still streaming for this reply. */
  live: boolean;
  /** True once answer text has started; auto-collapses the pane. */
  answerStarted: boolean;
}

/**
 * Collapsible reasoning pane, separate from answer text.
 *
 * Header shows a live "Thinking..." state and flips to "Thought for Ns"
 * (duration from the runtime-stamped elapsed_ms, never client clocks).
 * The body is a step timeline; the pane auto-collapses when the answer
 * starts unless the user explicitly expanded it.
 */
export function ThinkingPane({ blocks, live, answerStarted }: ThinkingPaneProps) {
  const [userToggle, setUserToggle] = useState<boolean | null>(null);

  if (blocks.length === 0) return null;

  const expanded = userToggle ?? !answerStarted;
  const totalMs = blocks.reduce((sum, b) => sum + b.elapsedMs, 0);
  const settled = !live && blocks.every((b) => b.done);

  return (
    <div className="flex flex-col items-start w-full max-w-[70%]" data-testid="thinking-pane">
      <button
        type="button"
        onClick={() => setUserToggle(!expanded)}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
        data-state={expanded ? "open" : "closed"}
      >
        {live ? (
          <>
            <CircleNotch size={13} className="animate-spin" />
            <span className="animate-pulse">Thinking...</span>
          </>
        ) : (
          <span>Thought for {formatThinkingDuration(totalMs)}</span>
        )}
        <CaretDown size={12} className={cn("transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <div className="mt-1 mb-1 w-full">
          {blocks.map((block, idx) => (
            <div key={block.blockId || idx} className="flex gap-2.5">
              <div className="flex flex-col items-center pt-1">
                {block.done ? (
                  <ClockCountdown size={14} className="text-muted-foreground/70 shrink-0" />
                ) : (
                  <CircleNotch size={14} className="animate-spin text-muted-foreground shrink-0" />
                )}
                <div className="w-px flex-1 bg-border mt-1" />
              </div>
              <div className="text-[13px] leading-relaxed text-muted-foreground break-words pb-3 min-w-0 flex-1">
                {block.done ? (
                  <CrepeEditor
                    contentType={ContentType.AGENT}
                    contentId=""
                    value={block.content}
                    readonly
                    compact
                    enableUpload={false}
                    className="chat-bubble-editor border-none bg-transparent [&_.crepe-editor-compact]:p-0 [&_.ProseMirror]:text-muted-foreground"
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{block.content}</span>
                )}
              </div>
            </div>
          ))}
          {settled && (
            <div className="flex items-center gap-2.5">
              <CheckCircle size={14} className="text-muted-foreground/70 shrink-0" />
              <span className="text-[13px] text-muted-foreground">Done</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
