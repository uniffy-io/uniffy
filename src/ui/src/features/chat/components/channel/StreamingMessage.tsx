/** Word-by-word reveal for agent replies; markdown renders live, with the partial tail sanitized. */

import { memo, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/feedback";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import { sanitizeStreamingMarkdown } from "@/features/chat/utils/streamingMarkdown";

interface StreamingMessageProps {
  content: string;
  streaming: boolean;
}

const FAST_INTERVAL_MS = 25;
const SLOW_INTERVAL_MS = 80;
const FAST_THRESHOLD_CHARS = 200;
// One word per tick caps the reveal near 180 chars/s, slower than every
// current model streams, so the backlog would otherwise grow without bound
// on long replies. Each tick therefore reveals at least the slice that keeps
// the remaining backlog drainable inside this budget.
const LIVE_CATCHUP_MS = 1200;
const SETTLED_CATCHUP_MS = 400;

function StreamingMessageInner({ content, streaming }: StreamingMessageProps) {
  // Show whatever content is present at mount immediately; only animate the
  // growth that arrives WHILE mounted (live deltas). A re-mounted or reopened
  // message already carries full content, so it never replays the reveal -
  // even if its `streaming` flag is stale (stopped/errored/raced run). The
  // live placeholder mounts empty and walks `visible` up via rAF as deltas land.
  const [visible, setVisible] = useState(content);
  const targetRef = useRef(content);
  const visibleLenRef = useRef(content.length);
  const streamingRef = useRef(streaming);
  const lastTickAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    targetRef.current = content;
    streamingRef.current = streaming;

    // Keep animating even after streaming ends until visible catches up.
    if (visibleLenRef.current >= content.length) return;
    if (rafRef.current !== null) return;

    const tick = (timestamp: number) => {
      try {
        const target = targetRef.current;
        const current = visibleLenRef.current;
        if (current >= target.length) {
          rafRef.current = null;
          return;
        }

        const remainingChars = target.length - current;
        const interval =
          remainingChars > FAST_THRESHOLD_CHARS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;

        const sinceLastTick = timestamp - lastTickAtRef.current;
        if (sinceLastTick < interval) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }
        lastTickAtRef.current = timestamp;

        // Skip leading whitespace then advance to end of the next word.
        let next = current;
        while (next < target.length && /\s/.test(target[next])) {
          next++;
        }
        while (next < target.length && !/\s/.test(target[next])) {
          next++;
        }

        if (next === current) {
          // Force forward progress so an empty advance can't loop rAF.
          next = Math.min(target.length, current + 1);
        }

        // Scale by real elapsed time: on a large document a single
        // markdown re-render can outlast several frame budgets, and a
        // nominal-interval step would let the backlog outrun the reveal
        // again. Clamped so a long pause (hidden tab, first tick) does
        // not dump the whole backlog in one step.
        const elapsedMs = Math.min(200, sinceLastTick);
        const catchupMs = streamingRef.current ? LIVE_CATCHUP_MS : SETTLED_CATCHUP_MS;
        const paced = current + Math.ceil((remainingChars * elapsedMs) / catchupMs);
        if (paced > next) {
          next = Math.min(target.length, paced);
        }

        visibleLenRef.current = next;
        setVisible(target.slice(0, next));
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [content, streaming]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const stillAnimating = visible.length < content.length;
  const showSettled = !streaming && !stillAnimating;

  if (showSettled) {
    return (
      <div data-testid="chat-streaming-content" data-streaming-state="settled">
        <MessageContent content={content} />
      </div>
    );
  }

  if (!visible) {
    return (
      <div
        className="flex items-center gap-1 text-muted-foreground/80 py-1"
        aria-label="Agent is responding"
        data-testid="chat-streaming-content"
        data-streaming-state="pending"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.2s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.1s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
      </div>
    );
  }

  return (
    <div data-testid="chat-streaming-content" data-streaming-state="streaming">
      <MessageContent content={sanitizeStreamingMarkdown(visible)} />
    </div>
  );
}

const MemoStreamingMessageInner = memo(StreamingMessageInner);

function StreamingFallback({ content }: StreamingMessageProps) {
  return (
    <div className="text-sm leading-[1.625] text-foreground/90 whitespace-pre-wrap break-words">
      {content}
    </div>
  );
}

function plainTextFallback(props: StreamingMessageProps) {
  return () => <StreamingFallback {...props} />;
}

export function StreamingMessage(props: StreamingMessageProps) {
  return (
    <ErrorBoundary fallback={plainTextFallback(props)}>
      <MemoStreamingMessageInner {...props} />
    </ErrorBoundary>
  );
}
