import { useState } from "react";
import { Card } from "@/components/ui/card";
import { SubjectAvatarById } from "@/components/subject";
import {
  BRAND_AXIS_END,
  BRAND_AXIS_START,
  brandGradient,
  identityPaint,
} from "@/config/theme/brandGradients";
import type { CallHistoryPerson } from "@/features/calls/api/historyConverters";
import {
  activityRuns,
  activityTime,
  activityCoverage,
  activityDescription,
} from "@/features/calls/utils/activityPresentation";

// Each person's bars take their own identity colour, so the legend spans the whole axis.
const SPEAKING_SWATCH = brandGradient({ start: BRAND_AXIS_START, end: BRAND_AXIS_END }, 90);

export function CallActivity({ people }: { people: CallHistoryPerson[] }) {
  const [selected, setSelected] = useState<{ userId: string; index: number } | null>(null);
  const attendees = people.filter((person) => person.presentSeconds > 0);
  const captured = attendees.some((person) => person.observedSeconds > 0);
  const duration = Math.max(1, ...people.map((person) => person.activityDurationSeconds));
  const selectedPerson = attendees.find((person) => person.userId === selected?.userId);
  const selectedBucket =
    selectedPerson?.activity[Math.min(selected?.index ?? 0, selectedPerson.activity.length - 1)];
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="px-4 pt-4 sm:px-5">
        <h2 className="sr-only">Speaking activity</h2>
        {!captured && (
          <p className="mb-3 text-xs text-muted-foreground">
            Speaking activity wasn't captured for this call. Attendance is shown below.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ backgroundImage: SPEAKING_SWATCH }} />
            Speaking
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1 w-3 rounded-sm bg-foreground/25" />
            Quiet
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-3 rounded-sm bg-muted"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg, transparent, transparent 2px, hsl(var(--border-strong)) 2px, hsl(var(--border-strong)) 3px)",
              }}
            />
            Unavailable
          </span>
          <span className="ml-auto text-subtle-foreground">Estimated</span>
        </div>
      </div>
      <div className="mt-3 px-4 sm:px-5">
        <div className="flex justify-between text-[10px] tabular-nums text-subtle-foreground md:ml-44">
          <span>0:00</span>
          <span>{activityTime(duration / 2)}</span>
          <span>{activityTime(duration)}</span>
        </div>
        {attendees.map((person) => {
          const paint = identityPaint(person.name);
          const active = selected?.userId === person.userId;
          const index = active ? Math.min(selected.index, person.activity.length - 1) : 0;
          return (
            <div
              key={person.userId}
              className="py-2.5 md:grid md:grid-cols-[10rem_1fr] md:items-center md:gap-4"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SubjectAvatarById userId={person.userId} displayName={person.name} size="xs" />
                <span className="truncate text-xs font-medium">{person.name}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground md:hidden">
                  {person.observedSeconds ? activityTime(person.speakingSeconds) : "No data"}
                </span>
              </div>
              <div
                role="slider"
                tabIndex={0}
                aria-label={`${person.name} speaking timeline`}
                aria-valuemin={0}
                aria-valuemax={person.activity.length - 1}
                aria-valuenow={index}
                aria-valuetext={activityDescription(
                  person.activity[index],
                  person.activityResolutionSeconds,
                  duration,
                )}
                className="focus-ring relative flex h-11 cursor-crosshair items-center rounded-sm"
                onPointerDown={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const position = Math.max(
                    0,
                    Math.min(
                      person.activity.length - 1,
                      Math.floor(
                        (((event.clientX - bounds.left) / bounds.width) * duration) /
                          person.activityResolutionSeconds,
                      ),
                    ),
                  );
                  setSelected({ userId: person.userId, index: position });
                  event.currentTarget.focus();
                }}
                onPointerMove={(event) => {
                  if (event.pointerType !== "mouse") return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setSelected({
                    userId: person.userId,
                    index: Math.max(
                      0,
                      Math.min(
                        person.activity.length - 1,
                        Math.floor(
                          (((event.clientX - bounds.left) / bounds.width) * duration) /
                            person.activityResolutionSeconds,
                        ),
                      ),
                    ),
                  });
                }}
                onKeyDown={(event) => {
                  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                  if (step || event.key === "Home" || event.key === "End") {
                    event.preventDefault();
                    setSelected({
                      userId: person.userId,
                      index:
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? person.activity.length - 1
                            : Math.max(0, Math.min(person.activity.length - 1, index + step)),
                    });
                  }
                }}
              >
                <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-border/60" />
                {activityRuns(person.activity, person.activityResolutionSeconds, duration).map(
                  (bucket) => (
                    <div
                      key={bucket.offsetSeconds}
                      className="relative flex h-5 items-center"
                      style={{
                        flex: bucket.durationSeconds,
                      }}
                    >
                      {bucket.presentSeconds > 0 && (
                        <span
                          className="absolute inset-0 bg-muted/80"
                          style={
                            bucket.observedSeconds < bucket.presentSeconds
                              ? {
                                  backgroundImage:
                                    "repeating-linear-gradient(135deg, transparent, transparent 3px, hsl(var(--border-strong)) 3px, hsl(var(--border-strong)) 4px)",
                                }
                              : undefined
                          }
                        />
                      )}
                      {bucket.observedSeconds > 0 && (
                        <span className="absolute inset-x-0 h-1 bg-foreground/25" />
                      )}
                      {bucket.speakingSeconds > 0 && (
                        <span
                          className="absolute inset-x-0 rounded-[1px]"
                          style={{
                            backgroundColor: paint.solid,
                            height: `${Math.max(25, (bucket.speakingSeconds / person.activityResolutionSeconds) * 100)}%`,
                          }}
                        />
                      )}
                    </div>
                  ),
                )}
                {active && (
                  <span
                    className="pointer-events-none absolute inset-y-1 w-px bg-foreground/60"
                    style={{
                      left: `${((person.activity[index].offsetSeconds + Math.min(person.activityResolutionSeconds, duration - person.activity[index].offsetSeconds) / 2) / duration) * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
        <p className="min-h-10 py-2 text-[11px] text-muted-foreground" aria-live="polite">
          {selectedPerson && selectedBucket
            ? `${selectedPerson.name}: ${activityDescription(selectedBucket, selectedPerson.activityResolutionSeconds, duration)}`
            : "Gaps show missing activity data, not silence. No audio is recorded."}
        </p>
      </div>
      {captured && (
        <div className="bg-background/60 px-4 py-4 sm:px-5">
          <h3 className="mb-3 text-xs font-medium">Talk time</h3>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {attendees.map((person) => (
              <div key={person.userId}>
                <div className="mb-1.5 flex justify-between gap-3 text-xs">
                  <span className="truncate">{person.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {person.observedSeconds ? activityTime(person.speakingSeconds) : "No data"}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (person.speakingSeconds / duration) * 100)}%`,
                      background: identityPaint(person.name).gradient,
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-subtle-foreground">
                  {activityCoverage(person.observedSeconds, person.presentSeconds)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
