import { Eye, EyeSlash, ListNumbers } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  toggleMarkdownPreview,
  toggleMarkdownLineNumbers,
} from "@/features/notes/store/editorSlice";

export function MarkdownModeBar() {
  const dispatch = useAppDispatch();
  const showMarkdownPreview = useAppSelector(
    (state) => state.editor.settings.showMarkdownPreview ?? true,
  );
  const showLineNumbers = useAppSelector(
    (state) => state.editor.settings.showMarkdownLineNumbers ?? true,
  );

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 bg-muted/40 border-b border-border/50">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
        Markdown options
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => dispatch(toggleMarkdownPreview())}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
            showMarkdownPreview
              ? "text-primary bg-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title={showMarkdownPreview ? "Hide Preview" : "Show Preview"}
        >
          {showMarkdownPreview ? (
            <EyeSlash size={14} weight="duotone" />
          ) : (
            <Eye size={14} weight="duotone" />
          )}
          <span>Preview</span>
        </button>
        <button
          onClick={() => dispatch(toggleMarkdownLineNumbers())}
          className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
            showLineNumbers
              ? "text-primary bg-primary/10"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title={showLineNumbers ? "Hide Line Numbers" : "Show Line Numbers"}
        >
          <ListNumbers size={14} weight="duotone" />
          <span>Line numbers</span>
        </button>
      </div>
    </div>
  );
}
