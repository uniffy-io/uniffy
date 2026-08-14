import {
  Funnel,
  ShareNetwork,
  CalendarBlank,
  ListChecks,
  ChatCircle,
  Megaphone,
  ShieldCheck,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import type { NotificationFilterType } from "@/features/notifications/store/notificationsSlice";

interface FilterOption {
  value: NotificationFilterType;
  label: string;
  icon?: Icon;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread", icon: Funnel },
  { value: "content", label: "Content", icon: ShareNetwork },
  { value: "calendar", label: "Calendar", icon: CalendarBlank },
  { value: "tasks", label: "Tasks", icon: ListChecks },
  { value: "chat", label: "Chat", icon: ChatCircle },
  { value: "permissions", label: "Access", icon: ShieldCheck },
  { value: "system", label: "System", icon: Megaphone },
];

interface NotificationFilterBarProps {
  activeFilter: NotificationFilterType;
  onFilterChange: (filter: NotificationFilterType) => void;
  unreadCount: number;
}

export function NotificationFilterBar({
  activeFilter,
  onFilterChange,
  unreadCount,
}: NotificationFilterBarProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
      {FILTER_OPTIONS.map((option) => {
        const isActive = activeFilter === option.value;
        const FilterIcon = option.icon;

        return (
          <button
            key={option.value}
            onClick={() => onFilterChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
              "whitespace-nowrap transition-colors shrink-0",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {FilterIcon && <FilterIcon size={12} weight={isActive ? "fill" : "regular"} />}
            {option.label}
            {option.value === "unread" && unreadCount > 0 && (
              <span
                className={cn(
                  "ml-0.5 min-w-[16px] h-4 px-1 rounded-full",
                  "text-[10px] font-bold leading-4 text-center",
                  isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
