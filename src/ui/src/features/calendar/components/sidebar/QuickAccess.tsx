import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setQuickAccessFilter, goToToday, setViewMode } from "@/features/calendar/store";
import type { QuickAccessFilter, ViewMode } from "@/features/calendar/types";
import { cn } from "@/shared/utils/cn";

interface QuickAccessItem {
  id: QuickAccessFilter;
  label: string;
  /** View the filtered set is legible in. */
  view?: ViewMode;
  jumpToToday?: boolean;
}

const quickAccessItems: QuickAccessItem[] = [
  { id: "today", label: "Today", view: "day", jumpToToday: true },
  { id: "this_week", label: "This Week", view: "week", jumpToToday: true },
  { id: "upcoming", label: "Upcoming", view: "agenda" },
];

export function QuickAccess() {
  const dispatch = useAppDispatch();
  const activeFilter = useAppSelector((state) => state.calendarUi.quickAccessFilter);

  const handleClick = (item: QuickAccessItem) => {
    if (activeFilter === item.id) {
      dispatch(setQuickAccessFilter(null));
      return;
    }

    dispatch(setQuickAccessFilter(item.id));
    if (item.jumpToToday) {
      dispatch(goToToday());
    }
    if (item.view) {
      dispatch(setViewMode(item.view));
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Quick Access
      </h3>
      <div className="space-y-1">
        {quickAccessItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleClick(item)}
            className={cn(
              "w-full flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors",
              activeFilter === item.id
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "w-3 h-3 rounded-full border",
                  activeFilter === item.id
                    ? "border-primary bg-primary"
                    : "border-muted-foreground",
                )}
              />
              <span>{item.label}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
