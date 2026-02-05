/**
 * QuickActionsWidget - Quick action buttons for common operations
 *
 * Provides shortcuts to create new content across all domains.
 */

import { useNavigate } from 'react-router-dom';
import {
  NotePencil,
  UploadSimple,
  CalendarPlus,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { WidgetCard } from '@/features/dashboard/components/widgets/WidgetCard';
import { useFormattedKeybinding } from '@/features/settings';

interface QuickAction {
  id: string;
  label: string;
  icon: Icon;
  shortcutKey?: string;
  onClick: () => void;
  color: string;
}

function QuickActionButton({ action }: { action: QuickAction }) {
  const shortcut = useFormattedKeybinding(action.shortcutKey ?? '');

  return (
    <button
      onClick={action.onClick}
      className={cn(
        'group flex flex-col items-center gap-2 rounded-xl p-4 transition-all duration-200',
        'bg-muted/30 hover:bg-muted border border-transparent hover:border-border',
        'focus:outline-none focus:ring-2 focus:ring-primary/20'
      )}
    >
      <div className={cn('rounded-lg p-2.5', action.color)}>
        <action.icon size={22} weight="duotone" className="text-white" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-foreground">{action.label}</p>
        {shortcut && (
          <p className="text-xs text-muted-foreground mt-0.5">{shortcut}</p>
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
      label: 'Upload',
      icon: UploadSimple,
      shortcutKey: 'files.upload',
      onClick: () => navigate('/files?upload=true'),
      color: 'bg-gradient-to-br from-blue-500 to-blue-600',
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
      id: 'search',
      label: 'Search',
      icon: MagnifyingGlass,
      shortcutKey: 'nav.search',
      onClick: () => {
        // Trigger spotlight search via keyboard event
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          metaKey: true,
          ctrlKey: navigator.platform.includes('Mac') ? false : true,
          bubbles: true,
        });
        document.dispatchEvent(event);
      },
      color: 'bg-gradient-to-br from-violet-500 to-violet-600',
    },
  ];

  return (
    <WidgetCard title="Quick Actions" colSpan={1} compact>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <QuickActionButton key={action.id} action={action} />
        ))}
      </div>
    </WidgetCard>
  );
}
