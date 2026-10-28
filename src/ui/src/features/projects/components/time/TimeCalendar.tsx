import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Plus } from "@phosphor-icons/react";
import { STATUS_HEX_COLORS } from "@/config/theme/statusColors";
import { DISPLAY_HOURS, GRID, LAYOUT } from "@/features/calendar/constants";
import { ACCENT_EVENT_COLOR, eventTint } from "@/features/calendar/constants/categoryColors";
import { cn } from "@/shared/utils/cn";
import { formatMinutes } from "@/shared/utils/durationFormatting";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import type { Worklog } from "@/features/projects/types/time";
import {
  DAY_MINUTES,
  SLOT_MINUTES,
  instantOf,
  layoutColumns,
  snapMinutes,
  timelineFor,
  wallOf,
  wallTimeOf,
  type TimelineBlock,
} from "@/features/projects/utils/timeClock";
import {
  dayStatus,
  offLabel,
  weekdayShort,
  type DayStatus,
} from "@/features/projects/utils/timeWeek";

// The same grid as the calendar domain, so the two timelines read as one product.
const HOUR_PX = GRID.HOUR_HEIGHT;
const MINUTE_PX = HOUR_PX / 60;
const TOP_PAD = 8;
const FIRST_VISIBLE_HOUR = 7;
const MIN_BLOCK_MINUTES = 15;
/** Shorter blocks have no room for the labelled lines and show the clock span alone. */
const LABELLED_BLOCK_MINUTES = 60;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const BLOCK_FILL = eventTint(ACCENT_EVENT_COLOR, 10);
const BLOCK_FILL_GHOST = eventTint(ACCENT_EVENT_COLOR, 20);

const STATUS_COLOR: Record<DayStatus, string | undefined> = {
  none: undefined,
  logged: undefined,
  under: STATUS_HEX_COLORS.warning,
  met: STATUS_HEX_COLORS.success,
  over: STATUS_HEX_COLORS.success,
};

export interface EntryPatch {
  workDate?: string;
  startedAt?: string;
  durationMinutes?: number;
}

interface TimeCalendarProps {
  days: readonly string[];
  today: string;
  worklogs: readonly Worklog[];
  totals: Record<string, number>;
  requirements: Record<string, { required: number; off: boolean }>;
  /** Task titles by id. */
  labels: Record<string, string>;
  /** Why a day cannot change, when it cannot. */
  lockHintFor: (day: string) => string | undefined;
  /** A click or a drag on free space; the length is absent for a plain click. */
  onCreate: (day: string, startTime: string, durationMinutes?: number) => void;
  onEdit: (entry: Worklog) => void;
  /** A block dragged to another time or day, or stretched. */
  onChange: (entry: Worklog, patch: EntryPatch) => void;
}

type Drag =
  | {
      kind: "create";
      day: string;
      anchor: number;
      current: number;
      /** The unsnapped minute under the pointer, which picks the slot for a plain click. */
      minute: number;
      moved: boolean;
    }
  | { kind: "resize"; entry: Worklog; start: number; length: number; moved: boolean }
  | {
      kind: "move";
      entry: Worklog;
      offset: number;
      length: number;
      day: string;
      start: number;
      moved: boolean;
    };

function clampStart(start: number, length: number): number {
  return Math.max(0, Math.min(DAY_MINUTES - length, start));
}

/** The week as a day timeline: entries with a start sit as blocks, the rest wait above. */
export function TimeCalendar({
  days,
  today,
  worklogs,
  totals,
  requirements,
  labels,
  lockHintFor,
  onCreate,
  onEdit,
  onChange,
}: TimeCalendarProps) {
  const zone = getEffectiveTimeZone();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // The slot a plain click picked; it carries the entries it was picked over, so it goes
  // away by itself once the week refetches after the entry is written.
  const [selected, setSelected] = useState<{
    day: string;
    slot: number;
    over: readonly Worklog[];
  } | null>(null);
  const slotHighlight = selected && selected.over === worklogs ? selected : null;
  const [nowMinute, setNowMinute] = useState(() => {
    const { day, wall } = wallTimeOf(new Date().toISOString(), zone);
    return day === today ? Number(wall.slice(0, 2)) * 60 + Number(wall.slice(3)) : -1;
  });

  const todayIndex = days.indexOf(today);

  const timelines = useMemo(() => {
    const byDay = new Map(days.map((day) => [day, [] as Worklog[]]));
    for (const entry of worklogs) byDay.get(entry.workDate)?.push(entry);
    return Object.fromEntries(
      days.map((day) => [day, timelineFor(byDay.get(day) ?? [], day, zone)]),
    );
  }, [days, worklogs, zone]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: TOP_PAD + FIRST_VISIBLE_HOUR * HOUR_PX });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const tick = () => {
      const { day, wall } = wallTimeOf(new Date().toISOString(), zone);
      setNowMinute(day === today ? Number(wall.slice(0, 2)) * 60 + Number(wall.slice(3)) : -1);
    };
    const interval = window.setInterval(tick, 60_000);
    return () => window.clearInterval(interval);
  }, [today, zone]);

  const place = (clientX: number, clientY: number): { day: string; minute: number } | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const column = Math.floor(((clientX - rect.left) / rect.width) * days.length);
    const minute = Math.max(0, Math.min(DAY_MINUTES, (clientY - rect.top - TOP_PAD) / MINUTE_PX));
    return { day: days[Math.max(0, Math.min(days.length - 1, column))], minute };
  };

  const update = (next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      const at = place(event.clientX, event.clientY);
      if (!current || !at) return;
      const snapped = snapMinutes(at.minute);
      if (current.kind === "create") {
        update({
          ...current,
          current: snapped,
          moved: current.moved || snapped !== current.anchor,
        });
      } else if (current.kind === "resize") {
        const length = Math.max(MIN_BLOCK_MINUTES, snapped - current.start);
        update({ ...current, length, moved: current.moved || length !== current.length });
      } else {
        const start = clampStart(snapMinutes(at.minute - current.offset), current.length);
        const moved = current.moved || start !== current.start || at.day !== current.day;
        update({ ...current, day: at.day, start, moved });
      }
    };
    const onUp = () => {
      const current = dragRef.current;
      update(null);
      if (!current) return;
      if (current.kind === "create") {
        const length = Math.abs(current.current - current.anchor);
        if (current.moved && length >= MIN_BLOCK_MINUTES) {
          onCreate(current.day, wallOf(Math.min(current.anchor, current.current)), length);
        } else {
          // A plain click picks the half-hour slot under the pointer, as the calendar does.
          const slot = Math.min(
            DAY_MINUTES - SLOT_MINUTES,
            Math.floor(current.minute / SLOT_MINUTES) * SLOT_MINUTES,
          );
          setSelected({ day: current.day, slot, over: worklogs });
          onCreate(current.day, wallOf(slot));
        }
      } else if (current.kind === "resize") {
        if (current.moved) onChange(current.entry, { durationMinutes: current.length });
        else onEdit(current.entry);
      } else if (current.moved) {
        onChange(current.entry, {
          ...(current.day !== current.entry.workDate ? { workDate: current.day } : {}),
          startedAt: instantOf(current.day, wallOf(current.start), zone),
        });
      } else {
        onEdit(current.entry);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // The listeners read the live drag through the ref; only the drag's presence matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const startCreate = (event: React.PointerEvent, day: string) => {
    if (event.button !== 0 || lockHintFor(day)) return;
    const at = place(event.clientX, event.clientY);
    if (!at) return;
    const anchor = snapMinutes(at.minute);
    setSelected(null);
    update({ kind: "create", day, anchor, current: anchor, minute: at.minute, moved: false });
  };

  const startBlockDrag = (
    event: React.PointerEvent,
    block: TimelineBlock,
    kind: "move" | "resize",
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (lockHintFor(block.entry.workDate)) {
      onEdit(block.entry);
      return;
    }
    const at = place(event.clientX, event.clientY);
    if (!at) return;
    if (kind === "resize") {
      update({ kind, entry: block.entry, start: block.start, length: block.length, moved: false });
    } else {
      update({
        kind,
        entry: block.entry,
        offset: at.minute - block.start,
        length: block.length,
        day: block.entry.workDate,
        start: block.start,
        moved: false,
      });
    }
  };

  const blockFor = (block: TimelineBlock): { start: number; length: number; ghost: boolean } => {
    if (drag && drag.kind !== "create" && drag.entry.id === block.entry.id) {
      if (drag.kind === "resize")
        return { start: drag.start, length: drag.length, ghost: drag.moved };
      return { start: drag.start, length: drag.length, ghost: drag.moved };
    }
    return { start: block.start, length: block.length, ghost: false };
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col" data-testid="time-calendar">
      {/* Scrolls like the grid so both reserve the same scrollbar width and the columns line up. */}
      <div className="invisible-scrollbar flex shrink-0 overflow-y-scroll border-b border-border bg-surface">
        <div
          className="shrink-0 border-r border-border bg-muted/50"
          style={{ width: LAYOUT.TIME_COLUMN_WIDTH }}
        />
        <div className="grid min-w-0 flex-1 grid-cols-7">
          {days.map((day) => {
            const { required, off } = requirements[day];
            const status = dayStatus(totals[day], required);
            const away = offLabel(required, off);
            const hint = lockHintFor(day);
            const share =
              required > 0 ? Math.min(100, Math.round((totals[day] / required) * 100)) : 0;
            return (
              <div
                key={day}
                className="min-w-0 border-l border-border px-2 pt-2 pb-1.5 text-xs first:border-l-0"
                data-testid="calendar-day-head"
                data-status={status}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-medium",
                      day === today ? "bg-primary text-primary-foreground" : "text-foreground",
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "font-medium",
                        day === today ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {weekdayShort(day)}
                    </div>
                    <div
                      className="truncate tabular-nums text-muted-foreground"
                      style={{ color: STATUS_COLOR[status] }}
                      data-testid="calendar-day-total"
                    >
                      {required > 0
                        ? `${formatMinutes(totals[day])} of ${formatMinutes(required)}`
                        : totals[day] > 0
                          ? formatMinutes(totals[day])
                          : (away ?? "free")}
                    </div>
                  </div>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${share}%`,
                      backgroundColor: STATUS_COLOR[status] ?? "var(--primary)",
                    }}
                  />
                </div>
                {/* One fixed slot right under the meter, so the row of plus buttons lines up
                    across the week whatever each day lists below it. */}
                {hint ? (
                  <div
                    className="mt-1 flex h-6 w-full items-center justify-center gap-1 rounded-md bg-muted/20 text-[10px] text-subtle-foreground"
                    title={hint}
                  >
                    <Lock size={9} /> locked
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 flex h-6 w-full items-center justify-center rounded-md bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => onCreate(day, wallOf(9 * 60))}
                    aria-label={`Log time on ${day}`}
                    data-testid="calendar-day-add"
                  >
                    <Plus size={12} />
                  </button>
                )}
                {away && required > 0 && (
                  <div className="mt-0.5 text-[10px] text-subtle-foreground">{away}</div>
                )}
                {timelines[day].unplaced.length > 0 && (
                  <ul className="mt-1 space-y-0.5" data-testid="calendar-unplaced">
                    {timelines[day].unplaced.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => onEdit(entry)}
                          className="flex w-full items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-left text-[11px] hover:bg-muted"
                          title="No time of day; click to set one"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {labels[entry.taskId] || "Task"}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {formatMinutes(entry.durationMinutes)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: TOP_PAD + 24 * HOUR_PX }}>
          <div
            className="relative shrink-0 select-none border-r border-border bg-muted/50"
            style={{ width: LAYOUT.TIME_COLUMN_WIDTH, paddingTop: TOP_PAD }}
          >
            {DISPLAY_HOURS.map((hour) => (
              <div
                key={hour.hour}
                className="flex items-start justify-end pr-2 text-xs text-muted-foreground"
                style={{ height: HOUR_PX }}
              >
                <span style={{ marginTop: -6 }}>{hour.hour > 0 ? hour.label : ""}</span>
              </div>
            ))}
          </div>
          <div
            ref={gridRef}
            className={cn("relative grid min-w-0 flex-1 grid-cols-7", drag && "select-none")}
            data-testid="calendar-grid"
          >
            {HOURS.map((hour) => (
              <div key={hour} className="pointer-events-none absolute inset-x-0">
                <div
                  className="absolute inset-x-0 border-t border-border/50"
                  style={{ top: TOP_PAD + hour * HOUR_PX }}
                />
                <div
                  className="absolute inset-x-0 border-t border-dashed border-border/30"
                  style={{ top: TOP_PAD + hour * HOUR_PX + HOUR_PX / 2 }}
                />
              </div>
            ))}
            {todayIndex >= 0 && (
              <div
                className="pointer-events-none absolute bg-primary/5"
                style={{
                  left: `${(todayIndex / days.length) * 100}%`,
                  width: `${100 / days.length}%`,
                  top: TOP_PAD,
                  bottom: 0,
                }}
              />
            )}
            {slotHighlight && days.includes(slotHighlight.day) && (
              <div
                className="pointer-events-none absolute z-10 border-2 border-primary bg-primary/20"
                style={{
                  left: `${(days.indexOf(slotHighlight.day) / days.length) * 100}%`,
                  width: `${100 / days.length}%`,
                  top: TOP_PAD + slotHighlight.slot * MINUTE_PX,
                  height: SLOT_MINUTES * MINUTE_PX,
                }}
                data-testid="calendar-selected-slot"
              />
            )}
            {/* On another week the line still marks the time of day, dashed all the way,
                muted when the week has passed and accent when it is still to come. */}
            {nowMinute >= 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                style={{ top: TOP_PAD + nowMinute * MINUTE_PX }}
                data-testid="calendar-now"
              >
                {days.map((day, index) => {
                  const isToday = index === todayIndex;
                  const isPast = todayIndex >= 0 ? index < todayIndex : day < today;
                  return (
                    <div
                      key={day}
                      className="flex items-center"
                      style={{ width: `${100 / days.length}%` }}
                    >
                      {isToday && (
                        <div className="-ml-1.5 h-3 w-3 shrink-0 rounded-full bg-primary" />
                      )}
                      <div
                        className={cn("h-0.5 flex-1", isToday && "bg-primary/80")}
                        style={
                          isToday
                            ? undefined
                            : {
                                backgroundImage:
                                  "repeating-linear-gradient(to right, currentColor, currentColor 4px, transparent 4px, transparent 8px)",
                                color: isPast
                                  ? "hsl(var(--muted-foreground) / 0.4)"
                                  : "hsl(var(--primary) / 0.6)",
                              }
                        }
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {days.map((day) => {
              const locked = Boolean(lockHintFor(day));
              const { blocks } = timelines[day];
              const columns = layoutColumns(blocks);
              const creating = drag?.kind === "create" && drag.day === day ? drag : null;
              const moving =
                drag?.kind === "move" && drag.day === day && drag.day !== drag.entry.workDate
                  ? drag
                  : null;
              return (
                <div
                  key={day}
                  className={cn(
                    "relative border-l border-border first:border-l-0",
                    locked ? "cursor-not-allowed bg-muted/20" : "cursor-pointer",
                  )}
                  onPointerDown={(event) => startCreate(event, day)}
                  data-testid="calendar-column"
                  data-day={day}
                >
                  {blocks.map((block, index) => {
                    const placed = blockFor(block);
                    if (
                      drag?.kind === "move" &&
                      drag.entry.id === block.entry.id &&
                      drag.day !== day
                    ) {
                      return null;
                    }
                    const { column, columns: count } = columns[index];
                    const title = labels[block.entry.taskId] || "Task";
                    return (
                      <div
                        key={block.entry.id}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-md px-2 text-left leading-tight transition-shadow hover:z-10 hover:shadow-md",
                          placed.length >= 30 ? "py-1.5" : "py-0.5",
                          !locked && "cursor-grab active:cursor-grabbing",
                        )}
                        style={{
                          top: TOP_PAD + placed.start * MINUTE_PX,
                          height: Math.max(18, placed.length * MINUTE_PX - 2),
                          left: `calc(${(column / count) * 100}% + 2px)`,
                          width: `calc(${100 / count}% - 4px)`,
                          backgroundColor: placed.ghost ? BLOCK_FILL_GHOST : BLOCK_FILL,
                        }}
                        onPointerDown={(event) => startBlockDrag(event, block, "move")}
                        title={`${title}, ${formatMinutes(block.entry.durationMinutes)} from ${wallOf(block.start)}`}
                        data-testid="calendar-block"
                        data-entry={block.entry.id}
                      >
                        <div
                          className={cn(
                            "truncate font-semibold text-foreground",
                            placed.length >= 30 ? "text-xs" : "text-[10px]",
                          )}
                        >
                          {title}
                        </div>
                        {placed.length >= LABELLED_BLOCK_MINUTES ? (
                          <>
                            {block.entry.description && (
                              <>
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  Description:
                                </div>
                                <div className="line-clamp-3 text-[10px] text-foreground">
                                  {block.entry.description}
                                </div>
                              </>
                            )}
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              Logged time:
                            </div>
                            <div className="truncate text-[10px] tabular-nums text-foreground">
                              {wallOf(placed.start)} to {wallOf(placed.start + placed.length)},{" "}
                              {formatMinutes(placed.length)}
                            </div>
                          </>
                        ) : (
                          <div className="truncate text-[10px] tabular-nums text-muted-foreground">
                            {wallOf(placed.start)} to {wallOf(placed.start + placed.length)},{" "}
                            {formatMinutes(placed.length)}
                          </div>
                        )}
                        {!locked && (
                          <div
                            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                            onPointerDown={(event) => startBlockDrag(event, block, "resize")}
                            data-testid="calendar-block-handle"
                          />
                        )}
                      </div>
                    );
                  })}
                  {moving && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-10 rounded-md border border-primary py-1 pr-2 pl-2.5 text-[11px]"
                      style={{
                        top: TOP_PAD + moving.start * MINUTE_PX,
                        height: Math.max(18, moving.length * MINUTE_PX - 2),
                        backgroundColor: BLOCK_FILL_GHOST,
                      }}
                    >
                      <div className="truncate font-medium">
                        {labels[moving.entry.taskId] || "Task"}
                      </div>
                      <div className="tabular-nums text-muted-foreground">
                        {wallOf(moving.start)} to {wallOf(moving.start + moving.length)}
                      </div>
                    </div>
                  )}
                  {creating && creating.moved && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 z-10 rounded border border-primary px-1.5 py-1 text-[11px]"
                      style={{
                        backgroundColor: BLOCK_FILL_GHOST,
                        top: TOP_PAD + Math.min(creating.anchor, creating.current) * MINUTE_PX,
                        height: Math.max(
                          18,
                          Math.abs(creating.current - creating.anchor) * MINUTE_PX - 2,
                        ),
                      }}
                      data-testid="calendar-create-ghost"
                    >
                      {wallOf(Math.min(creating.anchor, creating.current))} to{" "}
                      {wallOf(Math.max(creating.anchor, creating.current))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
