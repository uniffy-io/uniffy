/**
 * StreamingMessage - Word-by-word reveal for agent reply messages.
 *
 * Owns its own visible-cursor state so the animation runs entirely in
 * the UI, regardless of how the backend pipes content in. A provider
 * that flushes the whole reply in a single AGENT_TOKEN_DELTA still
 * paints word-by-word; a slow trickle still gets a smooth cursor.
 *
 * Lifecycle:
 *
 *  - In-flight bubble (`streaming=true`, content empty): three-dot
 *    pulse stands in for the bubble until the first chars land.
 *  - Animating (visible < content.length): plain pre-wrap text with a
 *    blinking caret. Markdown is intentionally NOT parsed mid-stream
 *    because react-markdown + rehype-highlight on every frame freezes
 *    the main thread.
 *  - Settled (`streaming=false` AND visible has caught up): full
 *    MessageContent with markdown, syntax highlighting, mention chips.
 *
 * Reveal pacing: rAF tick gated by elapsed wall time.  ~80ms/word
 * (~750 wpm) when caught up; ~25ms/word (~2400 wpm) when more than
 * 200 chars are buffered so we never lag a fast provider.  Still
 * advances at most one word boundary per gated tick which keeps the
 * eye comfortable.
 *
 * Isolation: wrapped in an ErrorBoundary so a crash in this component
 * cannot take the message list down -- the fallback prints whatever
 * raw content has arrived.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/feedback';
import { MessageContent } from '@/features/chat/components/channel/MessageContent';
import { cn } from '@/shared/utils/cn';

interface StreamingMessageProps {
    content: string;
    streaming: boolean;
}

const FAST_INTERVAL_MS = 25;
const SLOW_INTERVAL_MS = 80;
const FAST_THRESHOLD_CHARS = 200;

function StreamingMessageInner({ content, streaming }: StreamingMessageProps) {
    // Settled history messages mount with their full content already
    // visible -- no animation, no rAF, snap straight to MessageContent.
    // In-flight bubbles mount empty and walk visible up via the rAF
    // loop below as deltas arrive.
    const [visible, setVisible] = useState(streaming ? '' : content);
    const targetRef = useRef(content);
    const visibleLenRef = useRef(streaming ? 0 : content.length);
    const streamingRef = useRef(streaming);
    const lastTickAtRef = useRef(0);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        targetRef.current = content;
        streamingRef.current = streaming;

        // Always check whether more chars need revealing -- if streaming
        // ended but visible hasn't caught up yet, we keep animating
        // until we do, then swap to MessageContent.
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
                    remainingChars > FAST_THRESHOLD_CHARS
                        ? FAST_INTERVAL_MS
                        : SLOW_INTERVAL_MS;

                if (timestamp - lastTickAtRef.current < interval) {
                    rafRef.current = requestAnimationFrame(tick);
                    return;
                }
                lastTickAtRef.current = timestamp;

                // Advance to the end of the next word. Walk through any
                // leading whitespace first so a paragraph break does not
                // stall the cursor on a blank slot.
                let next = current;
                while (next < target.length && /\s/.test(target[next])) {
                    next++;
                }
                while (next < target.length && !/\s/.test(target[next])) {
                    next++;
                }

                if (next === current) {
                    // Defensive: a zero-length advance would loop forever
                    // burning rAF. Force progress by one char.
                    next = Math.min(target.length, current + 1);
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
        <div
            className="text-sm leading-[1.625] text-foreground/90 whitespace-pre-wrap break-words"
            data-testid="chat-streaming-content"
            data-streaming-state="streaming"
        >
            {visible}
            <span
                className={cn(
                    'inline-block w-[2px] h-[1em] ml-[1px] align-text-bottom',
                    'bg-primary/80 rounded-sm animate-pulse',
                )}
                aria-hidden="true"
            />
        </div>
    );
}

const MemoStreamingMessageInner = memo(StreamingMessageInner);

function StreamingFallback({ content }: StreamingMessageProps) {
    // No animation, no rAF, no markdown -- just whatever has arrived.
    return (
        <div className="text-sm leading-[1.625] text-foreground/90 whitespace-pre-wrap break-words">
            {content}
        </div>
    );
}

export function StreamingMessage(props: StreamingMessageProps) {
    return (
        <ErrorBoundary fallback={() => <StreamingFallback {...props} />}>
            <MemoStreamingMessageInner {...props} />
        </ErrorBoundary>
    );
}
