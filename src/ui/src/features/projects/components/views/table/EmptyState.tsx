/**
 * EmptyState - Shown when a project has no tasks
 *
 * Matches design spec mockup 06:
 * - Illustration with floating cards
 * - "Create your first task" heading
 * - Primary CTA button
 * - Keyboard shortcut hint
 * - Quick tips section
 */

import { Plus } from "@phosphor-icons/react";
import { useFormattedKeybinding } from "@/features/settings";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onCreateTask: () => void;
}

export function EmptyState({ onCreateTask }: EmptyStateProps) {
  const shortcut = useFormattedKeybinding("projects.newTask");

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md text-center">
        {/* Illustration */}
        <div className="relative mb-8">
          <div className="flex items-center justify-center gap-4">
            {/* Floating card illustrations */}
            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 -rotate-6 transform" />
            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 rotate-3 transform" />
            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 -rotate-3 transform" />
          </div>
          {/* Plus icon in center */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-14 h-14 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
              <Plus size={24} weight="bold" className="text-primary" />
            </div>
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-semibold text-foreground mb-2">
          Create your first task
        </h2>
        <p className="text-muted-foreground mb-6">
          Start building your project by adding tasks. You can organize them in
          Table, Board, or Roadmap views.
        </p>

        {/* Primary CTA */}
        <Button onClick={onCreateTask} className="mb-4">
          <Plus size={16} className="mr-2" />
          New Task
        </Button>

        {/* Keyboard shortcut hint */}
        {shortcut && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-8">
            <span>or press</span>
            <kbd className="px-2 py-1 rounded bg-muted text-xs font-mono">
              {shortcut}
            </kbd>
          </div>
        )}

        {/* Quick tips */}
        <div className="bg-card rounded-lg border border-border p-4 text-left">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Quick Tips
          </h3>
          <ul className="space-y-2">
            <TipItem color="primary">
              Use <kbd className="px-1 rounded bg-muted text-xs">@</kbd> in task
              descriptions to reference Notes, Files, or Chats
            </TipItem>
            <TipItem color="emerald-500">
              Drag tasks between Board columns to update status
            </TipItem>
            <TipItem color="amber-500">
              Add Start and Due dates to see tasks in Roadmap view
            </TipItem>
          </ul>
        </div>
      </div>
    </div>
  );
}

interface TipItemProps {
  color: string;
  children: React.ReactNode;
}

function TipItem({ color, children }: TipItemProps) {
  const dotColor = color === "primary" ? "bg-primary" : `bg-${color}`;
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <div className={`w-2 h-2 rounded-full ${dotColor} mt-1.5 flex-shrink-0`} />
      <span>{children}</span>
    </li>
  );
}
