import { type ReactNode } from "react";
import { PhoneCall, PhoneX, UserPlus, Info } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

// Lifecycle breadcrumbs (call started/ended, channel joins) arrive as SYSTEM
// messages whose content is a backend-composed string with [[[label|urn]]]
// user mentions. They render as a single self-contained capsule rather than the
// generic markdown path so the actor, duration, and roster read as one unit.

const MENTION_RE = /\[\[\[([^[\]|]+)\|([^\]]+)\]\]\]/g;
// Mirrors _format_call_duration: "Xh YYm" | "Xm YYs" | "Xs".
const DURATION_RE = /(\d+h \d{2}m|\d+m \d{2}s|\d+s)/;

type Part = { text: string } | { mention: string };

function parseParts(content: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of content.matchAll(MENTION_RE)) {
    const offset = match.index ?? 0;
    if (offset > last) parts.push({ text: content.slice(last, offset) });
    parts.push({ mention: match[1] });
    last = offset + match[0].length;
  }
  if (last < content.length) parts.push({ text: content.slice(last) });
  return parts;
}

type EventKind = "call-start" | "call-end" | "join" | "generic";

function classify(content: string): EventKind {
  const t = content.toLowerCase();
  if (t.includes("started a call")) return "call-start";
  if (t.includes("ended the call") || t.includes("call ended")) return "call-end";
  if (t.includes("joined the channel")) return "join";
  return "generic";
}

const KIND_STYLE: Record<EventKind, { Glyph: typeof PhoneCall; badge: string }> = {
  "call-start": { Glyph: PhoneCall, badge: "bg-green-500/15 text-green-600 dark:text-green-400" },
  "call-end": { Glyph: PhoneX, badge: "bg-red-500/15 text-red-600 dark:text-red-400" },
  join: { Glyph: UserPlus, badge: "bg-green-500/15 text-green-600 dark:text-green-400" },
  generic: { Glyph: Info, badge: "bg-muted-foreground/15 text-muted-foreground" },
};

// The backend joins segments with " - "; render it as a middot and lift the
// duration to a tabular emphasis so "Alice ended the call · 1m 42s · with Bob"
// reads cleanly.
function renderText(text: string, keyBase: string): ReactNode[] {
  const cleaned = text.replace(/ - /g, " · ");
  return cleaned.split(DURATION_RE).map((segment, i) => {
    if (!segment) return null;
    if (i % 2 === 1) {
      return (
        <span key={`${keyBase}-${i}`} className="font-semibold tabular-nums text-foreground/80">
          {segment}
        </span>
      );
    }
    return <span key={`${keyBase}-${i}`}>{segment}</span>;
  });
}

interface SystemMessageProps {
  content: string;
  messageId?: string;
}

export function SystemMessage({ content, messageId }: SystemMessageProps) {
  const parts = parseParts(content);
  const { Glyph, badge } = KIND_STYLE[classify(content)];

  return (
    <div
      className="flex justify-center py-2 px-4"
      data-testid={messageId ? `chat-message-${messageId}` : undefined}
      data-message-kind="system"
    >
      <div className="inline-flex max-w-[85%] items-center gap-2 rounded-full border border-border/60 bg-muted/40 px-3 py-1">
        <span
          className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", badge)}
        >
          <Glyph size={12} weight="fill" />
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {parts.map((part, i) =>
            "mention" in part ? (
              <span key={i} className="font-semibold text-foreground">
                {part.mention}
              </span>
            ) : (
              <span key={i}>{renderText(part.text, String(i))}</span>
            ),
          )}
        </span>
      </div>
    </div>
  );
}
