import { useCallback, useMemo, useState } from "react";
import {
  ShareNetwork,
  At,
  PencilSimple,
  Bell,
  CalendarPlus,
  CalendarCheck,
  ShieldCheck,
  ShieldSlash,
  Megaphone,
  ListChecks,
  ClockCountdown,
  Warning,
  ChatCircle,
  ChatCenteredText,
  UserPlus,
  UserMinus,
  ArrowBendUpLeft,
  CaretDown,
  CaretRight,
  CaretDoubleLeft,
  Funnel,
  Envelope,
  EnvelopeOpen,
  X,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import {
  toggleSelectedType,
  setIsReadFilter,
  clearAllFilters,
  toggleFilterSidebar,
} from "@/features/notifications/store/notificationsPageSlice";

interface TypeOption {
  value: number;
  label: string;
  icon: Icon;
}

interface TypeCategory {
  id: string;
  label: string;
  icon: Icon;
  types: TypeOption[];
}

const TYPE_CATEGORIES: TypeCategory[] = [
  {
    id: "content",
    label: "Content",
    icon: PencilSimple,
    types: [
      { value: NotificationType.CONTENT_SHARED, label: "Shared", icon: ShareNetwork },
      { value: NotificationType.CONTENT_MENTIONED, label: "Mentioned", icon: At },
      { value: NotificationType.CONTENT_EDITED, label: "Edited", icon: PencilSimple },
    ],
  },
  {
    id: "calendar",
    label: "Calendar",
    icon: CalendarPlus,
    types: [
      { value: NotificationType.CALENDAR_REMINDER, label: "Reminder", icon: Bell },
      { value: NotificationType.CALENDAR_INVITE, label: "Invite", icon: CalendarPlus },
      { value: NotificationType.CALENDAR_RESPONSE, label: "Response", icon: CalendarCheck },
    ],
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: ShieldCheck,
    types: [
      { value: NotificationType.PERMISSION_GRANTED, label: "Granted", icon: ShieldCheck },
      { value: NotificationType.PERMISSION_REVOKED, label: "Revoked", icon: ShieldSlash },
    ],
  },
  {
    id: "tasks",
    label: "Tasks",
    icon: ListChecks,
    types: [
      { value: NotificationType.TASK_ASSIGNED, label: "Assigned", icon: ListChecks },
      { value: NotificationType.TASK_DUE_SOON, label: "Due soon", icon: ClockCountdown },
      { value: NotificationType.TASK_OVERDUE, label: "Overdue", icon: Warning },
    ],
  },
  {
    id: "chat",
    label: "Chat",
    icon: ChatCircle,
    types: [
      { value: NotificationType.CHAT_MENTION, label: "Mention", icon: ChatCircle },
      { value: NotificationType.CHAT_DM, label: "Direct message", icon: ChatCenteredText },
      {
        value: NotificationType.CHAT_CHANNEL_INVITE,
        label: "Channel invite",
        icon: UserPlus,
      },
      { value: NotificationType.CHAT_CHANNEL_REMOVED, label: "Removed", icon: UserMinus },
      {
        value: NotificationType.CHAT_THREAD_REPLY,
        label: "Thread reply",
        icon: ArrowBendUpLeft,
      },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Megaphone,
    types: [
      { value: NotificationType.SYSTEM_ANNOUNCEMENT, label: "Announcement", icon: Megaphone },
    ],
  },
];

export function NotificationsFilterSidebar() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const selectedTypes = useAppSelector((s) => s.notificationsPage.selectedTypes);
  const isReadFilter = useAppSelector((s) => s.notificationsPage.isReadFilter);

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = { status: true };
    TYPE_CATEGORIES.forEach((cat) => {
      initial[cat.id] = true;
    });
    return initial;
  });

  const notifications = useAppSelector((s) => s.notificationsPage.notifications);
  const totalCount = useAppSelector((s) => s.notificationsPage.totalCount);
  const unreadCount = useAppSelector((s) => s.notificationsPage.unreadCount);

  const typeCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const n of notifications) {
      counts[n.notificationType] = (counts[n.notificationType] || 0) + 1;
    }
    return counts;
  }, [notifications]);

  const readCount = useMemo(() => {
    return notifications.filter((n) => n.isRead).length;
  }, [notifications]);

  const hasActiveFilters = selectedTypes.length > 0 || isReadFilter !== null;

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleToggleType = useCallback(
    (typeValue: number) => {
      dispatch(toggleSelectedType(typeValue));
    },
    [dispatch],
  );

  const handleReadFilter = useCallback(
    (value: boolean | null) => {
      dispatch(setIsReadFilter(value));
    },
    [dispatch],
  );

  const handleClearAll = useCallback(() => {
    dispatch(clearAllFilters());
  }, [dispatch]);

  const getActiveCountForCategory = (category: TypeCategory): number => {
    return category.types.filter((t) => selectedTypes.includes(t.value)).length;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-3 pt-3 pb-2 gap-0.5">
        <Funnel size={16} weight="duotone" className="text-muted-foreground shrink-0 ml-1" />
        <span className="text-sm font-semibold text-foreground ml-1.5">Filters</span>

        {hasActiveFilters && (
          <button
            onClick={handleClearAll}
            className="ml-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title="Clear all filters"
          >
            <X size={14} weight="bold" />
          </button>
        )}

        <div className="flex-1" />

        {!isMobile && (
          <button
            onClick={() => dispatch(toggleFilterSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            title="Toggle sidebar"
          >
            <CaretDoubleLeft size={16} weight="bold" className="text-primary" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        <nav className="space-y-0.5">
          <button
            onClick={() => toggleSection("status")}
            className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer"
          >
            {expandedSections.status ? (
              <CaretDown size={14} weight="bold" className="text-muted-foreground" />
            ) : (
              <CaretRight size={14} weight="bold" className="text-muted-foreground" />
            )}
            <Envelope size={16} weight="duotone" className="text-muted-foreground" />
            <span className="flex-1">Status</span>
            {isReadFilter !== null && (
              <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-primary/10 text-primary">
                1
              </span>
            )}
          </button>

          {expandedSections.status && (
            <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
              {(
                [
                  { value: null, label: "All", icon: Bell, count: totalCount },
                  {
                    value: false,
                    label: "Unread",
                    icon: Envelope,
                    count: unreadCount,
                  },
                  {
                    value: true,
                    label: "Read",
                    icon: EnvelopeOpen,
                    count: readCount,
                  },
                ] as const
              ).map((option) => {
                const isActive = isReadFilter === option.value;
                const OptionIcon = option.icon;
                return (
                  <button
                    key={String(option.value)}
                    onClick={() => handleReadFilter(option.value)}
                    className={cn(
                      "group w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left text-sm cursor-pointer",
                      "hover:bg-muted transition-colors",
                      isActive && "bg-primary/10 text-primary",
                    )}
                  >
                    <OptionIcon
                      size={16}
                      weight={isActive ? "fill" : "duotone"}
                      className={cn(
                        "shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span className="flex-1 truncate">{option.label}</span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground/60",
                      )}
                    >
                      {option.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {TYPE_CATEGORIES.map((category) => {
            const isExpanded = expandedSections[category.id] ?? true;
            const activeCount = getActiveCountForCategory(category);
            const CategoryIcon = category.icon;
            const categoryTotal = category.types.reduce(
              (sum, t) => sum + (typeCounts[t.value] || 0),
              0,
            );

            return (
              <div key={category.id}>
                <button
                  onClick={() => toggleSection(category.id)}
                  className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer"
                >
                  {isExpanded ? (
                    <CaretDown size={14} weight="bold" className="text-muted-foreground" />
                  ) : (
                    <CaretRight size={14} weight="bold" className="text-muted-foreground" />
                  )}
                  <CategoryIcon size={16} weight="duotone" className="text-muted-foreground" />
                  <span className="flex-1">{category.label}</span>
                  {activeCount > 0 && (
                    <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-primary/10 text-primary">
                      {activeCount}
                    </span>
                  )}
                  {categoryTotal > 0 && (
                    <span className="text-[10px] tabular-nums text-muted-foreground/60">
                      {categoryTotal}
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5">
                    {category.types.map((typeOption) => {
                      const isSelected = selectedTypes.includes(typeOption.value);
                      const TypeIcon = typeOption.icon;
                      const typeCount = typeCounts[typeOption.value] || 0;

                      return (
                        <button
                          key={typeOption.value}
                          onClick={() => handleToggleType(typeOption.value)}
                          className={cn(
                            "group w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left text-sm cursor-pointer",
                            "hover:bg-muted transition-colors",
                            isSelected && "bg-primary/10 text-primary",
                          )}
                        >
                          <TypeIcon
                            size={16}
                            weight={isSelected ? "fill" : "duotone"}
                            className={cn(
                              "shrink-0",
                              isSelected ? "text-primary" : "text-muted-foreground",
                            )}
                          />
                          <span className="flex-1 truncate">{typeOption.label}</span>
                          {typeCount > 0 && (
                            <span
                              className={cn(
                                "text-[10px] tabular-nums shrink-0",
                                isSelected ? "text-primary" : "text-muted-foreground/60",
                              )}
                            >
                              {typeCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {hasActiveFilters && (
        <div className="px-3 py-2 border-t border-border mt-auto">
          <button
            onClick={handleClearAll}
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <X size={14} />
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
