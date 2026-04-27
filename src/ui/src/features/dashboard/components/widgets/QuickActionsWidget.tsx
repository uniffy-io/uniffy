/**
 * QuickActionsWidget - Grid of action cards for common operations
 *
 * Each card shows an icon, label, and keyboard shortcut hint.
 * 3x2 grid on desktop, 2x3 on tablet and mobile.
 */

import { useNavigate } from 'react-router-dom';
import {
  NotePencil,
  UploadSimple,
  FolderOpen,
  CalendarPlus,
  CheckSquare,
  Brain,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { WidgetCard } from '@/features/dashboard/components/widgets/WidgetCard';
import { useFormattedKeybinding } from '@/features/settings';
import { Lightning } from '@phosphor-icons/react';

interface QuickAction {
  id: string;
  label: string;
  icon: Icon;
  shortcutKey?: string;
  onClick: () => void;
  color: string;
}

function QuickActionCard({ action }: { action: QuickAction }) {
  const shortcut = useFormattedKeybinding(action.shortcutKey ?? '');

  return (
    <button
      onClick={action.onClick}
      className={cn(
        'group flex flex-col items-center gap-2 rounded-xl p-3.5 transition-all duration-200',
        'bg-muted/30 hover:bg-muted border border-transparent hover:border-border',
        'focus:outline-none focus:ring-2 focus:ring-primary/20',
      )}
    >
      <div className={cn('rounded-lg p-2', action.color)}>
        <action.icon size={20} weight="duotone" className="text-white" />
      </div>
      <div className="text-center">
        <p className="text-xs font-medium text-foreground">{action.label}</p>
        {shortcut && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{shortcut}</p>
        )}
      </div>
    </button>
  );
}

export function QuickActionsWidget() {
  const navigate = useNavigate();

  const actions: QuickAction[] = [
    {
      id: 'new-note',
      label: 'New Note',
      icon: NotePencil,
      shortcutKey: 'editor.newNote',
      onClick: () => navigate('/notes?new=true'),
      color: 'bg-gradient-to-br from-primary to-primary/80',
    },
    {
      id: 'upload-file',
      label: 'Upload File',
      icon: UploadSimple,
      shortcutKey: 'files.upload',
      onClick: () => navigate('/files?upload=true'),
      color: 'bg-gradient-to-br from-blue-500 to-blue-600',
    },
    {
      id: 'upload-folder',
      label: 'Upload Folder',
      icon: FolderOpen,
      onClick: () => navigate('/files?uploadFolder=true'),
      color: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
    },
    {
      id: 'new-task',
      label: 'New Task',
      icon: CheckSquare,
      onClick: () => navigate('/projects'),
      color: 'bg-gradient-to-br from-teal-500 to-teal-600',
    },
    {
      id: 'new-event',
      label: 'New Event',
      icon: CalendarPlus,
      shortcutKey: 'calendar.newEvent',
      onClick: () => navigate('/calendar?new=true'),
      color: 'bg-gradient-to-br from-rose-500 to-rose-600',
    },
    {
      id: 'agent-session',
      label: 'Agent Chat',
      icon: Brain,
      onClick: () => navigate('/agents'),
      color: 'bg-gradient-to-br from-cyan-500 to-cyan-600',
    },
  ];

  return (
    <WidgetCard title="Quick Actions" icon={Lightning} colSpan={2} compact>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-3">
        {actions.map((action) => (
          <QuickActionCard key={action.id} action={action} />
        ))}
      </div>
    </WidgetCard>
  );
}
