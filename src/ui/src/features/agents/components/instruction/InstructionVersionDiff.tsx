import { useMemo, useState } from "react";
import { cn } from "@/shared/utils/cn";
import {
  diffLineParts,
  diffWordParts,
  type DiffMode,
} from "@/features/agents/utils/instructionDiff";

interface InstructionVersionDiffProps {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}

export function InstructionVersionDiff({
  oldText,
  newText,
  oldLabel,
  newLabel,
}: InstructionVersionDiffProps) {
  const [mode, setMode] = useState<DiffMode>("line");

  const parts = useMemo(
    () => (mode === "line" ? diffLineParts(oldText, newText) : diffWordParts(oldText, newText)),
    [mode, oldText, newText],
  );

  const unchanged = parts.length === 1 && !parts[0].added && !parts[0].removed;

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-xs text-muted-foreground truncate">
          <span className="text-red-500">{oldLabel}</span>
          {" → "}
          <span className="text-green-600 dark:text-green-400">{newLabel}</span>
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {(["line", "word"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                mode === m
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "line" ? "Lines" : "Words"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {unchanged ? (
          <span className="text-muted-foreground">No differences between these versions.</span>
        ) : mode === "line" ? (
          parts.map((part, i) => (
            <div
              key={i}
              className={cn(
                part.added &&
                  "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300",
                part.removed && "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-300",
              )}
            >
              {part.value}
            </div>
          ))
        ) : (
          parts.map((part, i) => (
            <span
              key={i}
              className={cn(
                part.added &&
                  "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-300",
                part.removed &&
                  "bg-red-100 text-red-900 line-through dark:bg-red-900/30 dark:text-red-300",
              )}
            >
              {part.value}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
