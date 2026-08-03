import {
  Eye,
  EyeSlash,
  ArrowsOutSimple,
  ArrowsInSimple,
  ArrowCounterClockwise,
  X,
  Check,
  Sliders,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import type { WidgetPreference, WidgetId } from '@/features/dashboard/hooks/useDashboardLayout';

const WIDGET_LABELS: Record<WidgetId, string> = {
  'today-agenda': "Today's Agenda",
  'my-tasks': 'My Tasks',
  'recent-activity': 'Recent Activity',
  'quick-actions': 'Quick Actions',
  'team-presence': 'Team Online',
  people: 'People',
  notifications: 'Notifications',
  'recent-notes': 'Recent Notes',
  'recent-files': 'Recent Files',
  bookmarks: 'Bookmarks',
  analytics: 'Your Activity',
  agents: 'Agent Sessions',
};

interface DashboardCustomizerButtonProps {
  onStartEditing: () => void;
}

export function DashboardCustomizerButton({ onStartEditing }: DashboardCustomizerButtonProps) {
  return (
    <button
      onClick={onStartEditing}
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        'hover:text-foreground transition-colors px-2 py-1 rounded-md',
        'hover:bg-muted/50',
      )}
    >
      <Sliders size={14} />
      Customize
    </button>
  );
}

interface DashboardCustomizerPanelProps {
  widgets: WidgetPreference[];
  onCancel: () => void;
  onSave: () => void;
  onToggleVisibility: (id: WidgetId) => void;
  onToggleSize: (id: WidgetId) => void;
  onReset: () => void;
}

export function DashboardCustomizerPanel({
  widgets,
  onCancel,
  onSave,
  onToggleVisibility,
  onToggleSize,
  onReset,
}: DashboardCustomizerPanelProps) {
  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Customize Dashboard</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowCounterClockwise size={12} />
            Reset
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md border border-border"
          >
            <X size={12} />
            Cancel
          </button>
          <button
            onClick={onSave}
            className="flex items-center gap-1 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors px-2.5 py-1 rounded-md"
          >
            <Check size={12} />
            Save
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {widgets.map((widget) => (
          <div
            key={widget.id}
            className={cn(
              'flex items-center justify-between rounded-lg border p-2.5 transition-colors',
              widget.visible ? 'border-border bg-card' : 'border-border/50 bg-muted/30 opacity-60',
            )}
          >
            <span className="text-xs font-medium truncate mr-2">
              {WIDGET_LABELS[widget.id]}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onToggleSize(widget.id)}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title={widget.size === 'expanded' ? 'Compact' : 'Expanded'}
              >
                {widget.size === 'expanded' ? (
                  <ArrowsInSimple size={12} />
                ) : (
                  <ArrowsOutSimple size={12} />
                )}
              </button>
              <button
                onClick={() => onToggleVisibility(widget.id)}
                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title={widget.visible ? 'Hide' : 'Show'}
              >
                {widget.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
