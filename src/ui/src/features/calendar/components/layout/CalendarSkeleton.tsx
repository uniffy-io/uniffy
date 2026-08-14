import { Skeleton } from "@/components/ui/skeleton";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarSkeleton() {
  return (
    <div className="flex-1 flex flex-col p-2 md:p-4 animate-in fade-in-0 duration-300">
      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAY_NAMES.map((day) => (
          <div key={day} className="text-center py-1">
            <span className="text-xs font-medium text-muted-foreground">{day}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 flex-1">
        {Array.from({ length: 35 }, (_, i) => (
          <div
            key={i}
            className="border border-border/50 rounded-md p-1.5 min-h-[60px] md:min-h-[80px]"
          >
            <Skeleton variant="text" className="w-5 h-3 mb-1.5" />
            {/* Index-based pseudo-randomness keeps event blocks deterministic across renders. */}
            {i % 3 === 0 && <Skeleton variant="rectangular" className="w-full h-3 mb-1" />}
            {i % 5 === 1 && (
              <>
                <Skeleton variant="rectangular" className="w-full h-3 mb-1" />
                <Skeleton variant="rectangular" className="w-3/4 h-3" />
              </>
            )}
            {i % 7 === 3 && <Skeleton variant="rectangular" className="w-2/3 h-3" />}
          </div>
        ))}
      </div>
    </div>
  );
}
