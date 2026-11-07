import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { fetchCalendarConnections } from "@/features/calendar/store/calendarConnectionsThunks";
import { cn } from "@/shared/utils/cn";

/** Shown in place of the account list when loading it failed; the toast already named the cause. */
export function ConnectionsLoadError({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  return (
    <div
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
      data-testid="connections-load-error"
    >
      <span className="flex-1">Could not load connected accounts.</span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => void dispatch(fetchCalendarConnections())}
      >
        Retry
      </Button>
    </div>
  );
}
