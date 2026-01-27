/**
 * ConflictTooltip - Shows details of conflicting events
 */

import { useState } from 'react';
import type { CalendarEvent } from '../../types';
import { formatTimeRange } from '../../utils';
import { cn } from '@/utils/cn';
import { Warning } from '@phosphor-icons/react';

interface ConflictTooltipProps {
  conflictingEvents: CalendarEvent[];
}

export function ConflictTooltip({ conflictingEvents }: ConflictTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (conflictingEvents.length === 0) return null;

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 hover:bg-yellow-200 dark:hover:bg-yellow-900/50 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        title={`Conflicts with ${conflictingEvents.length} other event(s)`}
      >
        <Warning size={12} weight="duotone" className="text-yellow-600 dark:text-yellow-400" />
        <span className="text-[10px] font-medium text-yellow-800 dark:text-yellow-400">
          {conflictingEvents.length}
        </span>
      </button>

      {/* Tooltip popover */}
      {isOpen && (
        <div
          className={cn(
            'absolute bottom-full left-0 mb-1 z-30',
            'min-w-[200px] max-w-[280px]',
            'bg-card text-card-foreground border border-border rounded-lg shadow-xl',
            'p-3'
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
            <Warning size={16} weight="duotone" className="text-yellow-600 dark:text-yellow-400" />
            <span className="text-xs font-semibold text-yellow-800 dark:text-yellow-400">
              {conflictingEvents.length} Conflicting Event{conflictingEvents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Conflicting events list */}
          <div className="space-y-2">
            {conflictingEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-col gap-0.5 p-2 rounded-md bg-muted hover:bg-muted/80 transition-colors"
              >
                <div className="text-xs font-medium text-foreground truncate">
                  {event.title}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatTimeRange(event.startTime, event.endTime)}
                </div>
                {event.location && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    📍 {event.location}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Footer tip */}
          <div className="mt-2 pt-2 border-t border-border text-[10px] text-muted-foreground">
            Consider rescheduling to avoid conflicts
          </div>
        </div>
      )}
    </div>
  );
}
