import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { sectionLabelClass } from "@/features/agents/components/instruction/detailChrome";

/**
 * Body of a skill or rule detail: one reading column under the pane header.
 * The page scrolls, the editor grows with its content, and every section sits
 * in a card so the markdown never bleeds edge to edge.
 */
export function DetailBody({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid={testId}>
      <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-6">{children}</div>
    </div>
  );
}

export function DetailSection({
  label,
  hint,
  action,
  children,
  testId,
}: {
  label: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={sectionLabelClass}>{label}</h3>
          {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A section the reader opens on demand, such as version history. */
export function DetailToggleSection({
  label,
  summary,
  open,
  onToggle,
  children,
  sectionRef,
  testId,
}: {
  label: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  sectionRef?: RefObject<HTMLElement | null>;
  testId?: string;
}) {
  return (
    <section ref={sectionRef} className="space-y-3 scroll-mt-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
        data-testid={testId}
      >
        {open ? (
          <CaretDown size={12} className="shrink-0 text-muted-foreground" />
        ) : (
          <CaretRight size={12} className="shrink-0 text-muted-foreground" />
        )}
        <span className={sectionLabelClass}>{label}</span>
        {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
      </button>
      {open && children}
    </section>
  );
}

export function DetailCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("p-5", className)}>{children}</Card>;
}

/** Two fields side by side on wide panes, stacked on narrow ones. */
export function DetailFieldRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 md:grid-cols-2">{children}</div>;
}

export const fieldLabelClass =
  "block text-xs font-medium uppercase tracking-wider text-muted-foreground";

export function DetailField({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className={fieldLabelClass}>{label}</p>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A value the form shows but never edits, like the identifier a skill is invoked by. */
export function DetailReadOnlyValue({
  children,
  mono = false,
  testId,
}: {
  children: ReactNode;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <p
      className={cn(
        "flex h-10 items-center rounded-md border border-dashed border-border bg-muted/30 px-3 text-sm text-foreground",
        mono && "font-mono",
      )}
      data-testid={testId}
    >
      {children}
    </p>
  );
}

interface DetailTextFieldProps {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  /**
   * Report every keystroke instead of committing on blur or Enter. Unsaved
   * forms want the raw text live; saved rows want one write per edit.
   */
  live?: boolean;
  /** An empty commit restores the previous value instead of saving. */
  required?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  testId?: string;
}

export function DetailTextField({
  label,
  value,
  onCommit,
  live = false,
  required = false,
  placeholder,
  hint,
  disabled = false,
  autoFocus = false,
  testId,
}: DetailTextFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const skipCommitRef = useRef(false);
  const shown = live ? value : text;

  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    const next = text.trim();
    if (!next && required) {
      setText(value);
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <Input
        id={id}
        value={shown}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          if (live) onCommit(e.target.value);
          else setText(e.target.value);
        }}
        onBlur={live ? undefined : commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape" && !live) {
            skipCommitRef.current = true;
            setText(value);
            e.currentTarget.blur();
          }
        }}
        data-testid={testId}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Card around the markdown editor; `footer` carries a read-only or retired notice. */
export function DetailEditorCard({
  children,
  footer,
  testId,
}: {
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      {children}
      {footer && (
        <div className="rounded-b-xl border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </Card>
  );
}

/**
 * Wrapper classes for a compact editor in a detail card. `instruction-editor`
 * lifts the wrapper's overflow clip (see editor.css) so Crepe's slash menu and
 * toolbar can extend past the card; the bottom band keeps the last line, and a
 * menu opened on it, clear of the card edge.
 */
export const detailEditorClass = "instruction-editor px-2 pt-3 pb-16";
export const DETAIL_EDITOR_MIN_HEIGHT = "480px";
