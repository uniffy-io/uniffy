import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CaretDown, CaretRight, BellSimple } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { parseUrn } from "@/shared/utils/urn";
import { notificationTargetPath } from "@/features/notifications/utils/notificationTarget";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { getUrnTypeTheme } from "@/config/theme/urnColors";
import { formatSmartDateTime } from "@/shared/utils/dateFormatting";
import { NotificationItem } from "@/features/notifications/components/NotificationItem";
import {
  markNotificationAsRead,
  deleteNotification,
} from "@/features/notifications/store/notificationsSlice";
import {
  toggleSelectedId,
  toggleSelectedGroup,
} from "@/features/notifications/store/notificationsPageSlice";
import type { SerializedPageNotification } from "@/features/notifications/store/notificationsPageSlice";

interface NotificationGroup {
  sourceUrn: string;
  notifications: SerializedPageNotification[];
  latestAt: string;
}

function groupBySource(notifications: SerializedPageNotification[]): NotificationGroup[] {
  const map = new Map<string, SerializedPageNotification[]>();

  for (const n of notifications) {
    const key = n.sourceUrn || `no-source-${n.id}`;
    const group = map.get(key);
    if (group) {
      group.push(n);
    } else {
      map.set(key, [n]);
    }
  }

  const groups: NotificationGroup[] = [];
  for (const [sourceUrn, items] of map.entries()) {
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    groups.push({
      sourceUrn,
      notifications: items,
      latestAt: items[0].createdAt,
    });
  }

  groups.sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
  return groups;
}

export function NotificationsGroupedView() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const notifications = useAppSelector((s) => s.notificationsPage.notifications);
  const loading = useAppSelector((s) => s.notificationsPage.loading);
  const selectedIds = useAppSelector((s) => s.notificationsPage.selectedIds);

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupBySource(notifications), [notifications]);

  const toggleGroup = useCallback((sourceUrn: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(sourceUrn)) {
        next.delete(sourceUrn);
      } else {
        next.add(sourceUrn);
      }
      return next;
    });
  }, []);

  const handleMarkAsRead = useCallback(
    (id: string) => {
      dispatch(markNotificationAsRead(id));
    },
    [dispatch],
  );

  const handleDelete = useCallback(
    (id: string) => {
      dispatch(deleteNotification(id));
    },
    [dispatch],
  );

  const handleClick = useCallback(
    (notification: SerializedPageNotification) => {
      if (!notification.isRead) {
        dispatch(markNotificationAsRead(notification.id));
      }
      const path = notificationTargetPath(notification);
      if (path) {
        navigate(path);
      }
    },
    [dispatch, navigate],
  );

  if (loading && notifications.length === 0) {
    return (
      <div className="px-4 md:px-6 py-4 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg border border-border p-4 space-y-3">
            <div className="h-4 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted/60 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 mb-4">
          <BellSimple size={32} weight="duotone" className="text-muted-foreground/50" />
        </div>
        <p className="text-base font-medium text-foreground/60 mb-1">No notifications found</p>
        <p className="text-sm text-muted-foreground/60 text-center max-w-[300px]">
          Try adjusting your filters or search query.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 md:px-4 lg:px-6 py-3 space-y-2">
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.sourceUrn);
          const latest = group.notifications[0];
          const unreadCount = group.notifications.filter((n) => !n.isRead).length;
          const parsedUrn = group.sourceUrn ? parseUrn(group.sourceUrn) : null;
          const sourceConfig = parsedUrn?.isValid ? getContentTypeConfig(parsedUrn.type) : null;
          const sourceTheme = parsedUrn?.isValid ? getUrnTypeTheme(parsedUrn.type) : null;
          const SourceIcon = sourceConfig?.icon;

          const groupIds = group.notifications.map((n) => n.id);
          const allGroupSelected =
            groupIds.length > 0 && groupIds.every((id) => selectedIds.includes(id));
          const someGroupSelected =
            !allGroupSelected && groupIds.some((id) => selectedIds.includes(id));

          return (
            <div
              key={group.sourceUrn}
              className={cn(
                "rounded-lg border overflow-hidden",
                unreadCount > 0 ? "border-primary/30 bg-primary/[0.05] shadow-sm" : "border-border",
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-3 w-full px-3 md:px-4 py-3 text-left",
                  "hover:bg-muted/30 transition-colors",
                )}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch(toggleSelectedGroup(groupIds));
                  }}
                  className={cn(
                    "w-4 h-4 rounded border-2 transition-colors flex items-center justify-center shrink-0",
                    allGroupSelected
                      ? "bg-primary border-primary"
                      : someGroupSelected
                        ? "bg-primary/50 border-primary"
                        : "border-border hover:border-primary/60",
                  )}
                  title={allGroupSelected ? "Deselect group" : "Select group"}
                >
                  {(allGroupSelected || someGroupSelected) && (
                    <svg
                      className="w-2.5 h-2.5 text-primary-foreground"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      {allGroupSelected ? (
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : (
                        <path
                          d="M3 6h6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      )}
                    </svg>
                  )}
                </button>

                <button
                  onClick={() => toggleGroup(group.sourceUrn)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  {isExpanded ? (
                    <CaretDown size={14} className="text-muted-foreground shrink-0" />
                  ) : (
                    <CaretRight size={14} className="text-muted-foreground shrink-0" />
                  )}

                  {sourceConfig && SourceIcon && sourceTheme && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0",
                        sourceTheme.badgeBg,
                        sourceTheme.accentText,
                      )}
                    >
                      <SourceIcon size={10} weight="fill" />
                      {sourceConfig.label}
                    </span>
                  )}

                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm truncate",
                        unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground",
                      )}
                    >
                      {latest.title}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                      {formatSmartDateTime(latest.createdAt)}
                    </span>
                    {unreadCount > 0 && (
                      <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold leading-5 text-center">
                        {unreadCount}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 font-medium tabular-nums">
                      {group.notifications.length}
                    </span>
                  </div>
                </button>
              </div>

              {isExpanded && (
                <div className="border-t border-border/50">
                  {group.notifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={cn(
                        "relative flex items-start transition-colors",
                        notification.isRead
                          ? "hover:bg-muted/30"
                          : "bg-primary/10 hover:bg-primary/15",
                      )}
                    >
                      {!notification.isRead && (
                        <span className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
                      )}
                      <div className="flex items-center pl-2 md:pl-4 pt-4 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch(toggleSelectedId(notification.id));
                          }}
                          className={cn(
                            "w-4 h-4 rounded border-2 transition-colors flex items-center justify-center",
                            selectedIds.includes(notification.id)
                              ? "bg-primary border-primary"
                              : "border-border hover:border-primary/60",
                          )}
                        >
                          {selectedIds.includes(notification.id) && (
                            <svg
                              className="w-2.5 h-2.5 text-primary-foreground"
                              viewBox="0 0 12 12"
                              fill="none"
                            >
                              <path
                                d="M2 6l3 3 5-5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <NotificationItem
                          notification={notification}
                          onMarkAsRead={handleMarkAsRead}
                          onDelete={handleDelete}
                          onClick={() => handleClick(notification)}
                          hideRowBackground
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
