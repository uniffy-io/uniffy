import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import type { TimeSlot } from '@/features/rooms/types';

const START_HOUR = 8;
const END_HOUR = 20;

interface AvailabilityGridProps {
  slots: TimeSlot[];
  onSlotClick?: (startHour: number, endHour: number) => void;
  className?: string;
}

function getHour(isoString: string): number {
  return new Date(isoString).getHours();
}

function buildHourMap(slots: TimeSlot[]): Map<number, TimeSlot> {
  const map = new Map<number, TimeSlot>();
  for (const slot of slots) {
    const startHour = getHour(slot.startTime);
    const endHour = getHour(slot.endTime);
    for (let h = startHour; h < endHour; h++) {
      map.set(h, slot);
    }
  }
  return map;
}

export function AvailabilityGrid({ slots, onSlotClick, className }: AvailabilityGridProps) {
  const hourMap = useMemo(() => buildHourMap(slots), [slots]);

  const hours = useMemo(() => {
    const result: { hour: number; label: string; isAvailable: boolean; bookerName: string }[] = [];
    for (let h = START_HOUR; h < END_HOUR; h++) {
      const slot = hourMap.get(h);
      const isAvailable = slot ? slot.isAvailable : true;
      const suffix = h < 12 ? 'a' : 'p';
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      result.push({
        hour: h,
        label: `${displayHour}${suffix}`,
        isAvailable,
        bookerName: slot?.bookerName || '',
      });
    }
    return result;
  }, [hourMap]);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex">
        {hours.map((h, i) => (
          <div
            key={h.hour}
            className={cn(
              'flex-1 text-center text-[10px] text-muted-foreground',
              i === 0 && 'text-left',
              i === hours.length - 1 && 'text-right',
            )}
          >
            {i % 2 === 0 ? h.label : ''}
          </div>
        ))}
      </div>

      <div className="flex h-7 rounded-md overflow-hidden border border-border">
        {hours.map((h) => (
          <button
            key={h.hour}
            type="button"
            disabled={!h.isAvailable || !onSlotClick}
            title={h.isAvailable ? `${h.label} - Available` : `${h.label} - ${h.bookerName || 'Booked'}`}
            onClick={() => {
              if (h.isAvailable && onSlotClick) {
                onSlotClick(h.hour, h.hour + 1);
              }
            }}
            className={cn(
              'flex-1 transition-colors border-r border-border/40 last:border-r-0',
              h.isAvailable
                ? 'bg-muted hover:bg-muted/70 cursor-pointer'
                : 'bg-primary/40 cursor-default',
              !h.isAvailable && 'relative group',
            )}
          >
            {!h.isAvailable && h.bookerName && (
              <span
                className={cn(
                  'absolute bottom-full left-1/2 -translate-x-1/2 mb-1',
                  'hidden group-hover:block',
                  'px-2 py-1 text-xs rounded-md',
                  'bg-card text-foreground border border-border shadow-lg',
                  'whitespace-nowrap z-10 pointer-events-none',
                )}
              >
                {h.bookerName}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-muted border border-border/40" />
          <span>Available</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-primary/40 border border-border/40" />
          <span>Booked</span>
        </div>
      </div>
    </div>
  );
}
