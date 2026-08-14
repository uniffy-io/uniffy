import { useCallback, useEffect, useRef, useState } from "react";
import {
  MagnifyingGlass,
  CheckCircle,
  GearSix,
  ListBullets,
  SquaresFour,
  Check,
  Trash,
  ArrowCounterClockwise,
  User,
  X,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { DatePicker } from "@/components/ui/date-picker";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { SubjectPicker } from "@/components/subject/SubjectPicker";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { markAllNotificationsAsRead } from "@/features/notifications/store/notificationsSlice";
import {
  setPageSearchQuery,
  setViewMode,
  selectAllOnPage,
  clearSelection,
  bulkMarkAsReadPage,
  bulkDeleteNotificationsPage,
  searchPageNotifications,
  setDateRange,
  setActorFilter,
  clearLastAction,
} from "@/features/notifications/store/notificationsPageSlice";
import type { PageViewMode } from "@/features/notifications/store/notificationsPageSlice";

type DatePreset = "all" | "today" | "yesterday" | "week" | "month";

function getDatePresetRange(preset: DatePreset): { from: string | null; to: string | null } {
  if (preset === "all") return { from: null, to: null };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (preset === "today") {
    return { from: todayStart.toISOString(), to: null };
  }
  if (preset === "yesterday") {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return { from: yesterdayStart.toISOString(), to: todayStart.toISOString() };
  }
  if (preset === "week") {
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    return { from: weekStart.toISOString(), to: null };
  }
  const monthStart = new Date(todayStart);
  monthStart.setDate(monthStart.getDate() - 30);
  return { from: monthStart.toISOString(), to: null };
}

function getActiveDatePreset(dateFrom: string | null, dateTo: string | null): DatePreset | null {
  if (!dateFrom && !dateTo) return "all";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = dateFrom ? new Date(dateFrom) : null;

  if (from && dateTo) {
    const to = new Date(dateTo);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    if (
      Math.abs(from.getTime() - yesterdayStart.getTime()) < 60000 &&
      Math.abs(to.getTime() - todayStart.getTime()) < 60000
    ) {
      return "yesterday";
    }
  }

  if (from && !dateTo) {
    if (Math.abs(from.getTime() - todayStart.getTime()) < 60000) return "today";
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    if (Math.abs(from.getTime() - weekStart.getTime()) < 60000) return "week";
    const monthStart = new Date(todayStart);
    monthStart.setDate(monthStart.getDate() - 30);
    if (Math.abs(from.getTime() - monthStart.getTime()) < 60000) return "month";
  }

  return null;
}

function isoToDatePickerValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function datePickerValueToIso(value: string): string | null {
  if (!value) return null;
  return new Date(value + "T00:00:00").toISOString();
}

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "all", label: "Any time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

export function NotificationsPageHeader() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();

  const searchQuery = useAppSelector((s) => s.notificationsPage.searchQuery);
  const viewMode = useAppSelector((s) => s.notificationsPage.viewMode);
  const unreadCount = useAppSelector((s) => s.notificationsPage.unreadCount);
  const selectedIds = useAppSelector((s) => s.notificationsPage.selectedIds);
  const notifications = useAppSelector((s) => s.notificationsPage.notifications);
  const updating = useAppSelector((s) => s.notificationsPage.updating);
  const dateFrom = useAppSelector((s) => s.notificationsPage.dateFrom);
  const dateTo = useAppSelector((s) => s.notificationsPage.dateTo);
  const actorId = useAppSelector((s) => s.notificationsPage.actorId);

  const { subjects: actorSubjects } = useSubjectResolver(actorId ? [actorId] : []);
  const actorSubject = actorSubjects.length > 0 ? actorSubjects[0] : null;
  const [showUserPicker, setShowUserPicker] = useState(false);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  const lastActionMessage = useAppSelector((s) => s.notificationsPage.lastActionMessage);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastActionMessage) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => dispatch(clearLastAction()), 6000);
    }
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, [lastActionMessage, dispatch]);

  const hasSelection = selectedIds.length > 0;
  const allSelected = notifications.length > 0 && selectedIds.length === notifications.length;
  const someSelected = hasSelection && !allSelected;
  const activeDatePreset = getActiveDatePreset(dateFrom, dateTo);
  const hasCustomDateRange = dateFrom !== null || dateTo !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatch(setPageSearchQuery(e.target.value));
    },
    [dispatch],
  );

  const handleClearSearch = useCallback(() => {
    dispatch(setPageSearchQuery(""));
  }, [dispatch]);

  const handleMarkAllRead = useCallback(() => {
    dispatch(markAllNotificationsAsRead());
  }, [dispatch]);

  const handleViewModeChange = useCallback(
    (mode: PageViewMode) => {
      dispatch(setViewMode(mode));
    },
    [dispatch],
  );

  const handleDatePreset = useCallback(
    (preset: DatePreset) => {
      dispatch(setDateRange(getDatePresetRange(preset)));
    },
    [dispatch],
  );

  const handleDateFromChange = useCallback(
    (value: string) => {
      dispatch(setDateRange({ from: datePickerValueToIso(value), to: dateTo }));
    },
    [dispatch, dateTo],
  );

  const handleDateToChange = useCallback(
    (value: string) => {
      dispatch(setDateRange({ from: dateFrom, to: datePickerValueToIso(value) }));
    },
    [dispatch, dateFrom],
  );

  const handleActorSelect = useCallback(
    (ids: string[]) => {
      dispatch(setActorFilter(ids.length > 0 ? ids[0] : null));
      setShowUserPicker(false);
    },
    [dispatch],
  );

  const handleUndo = useCallback(() => {
    dispatch(clearLastAction());
    dispatch(searchPageNotifications());
  }, [dispatch]);

  const handleBulkMarkRead = useCallback(() => {
    dispatch(bulkMarkAsReadPage(selectedIds));
  }, [dispatch, selectedIds]);

  const handleBulkDelete = useCallback(() => {
    dispatch(bulkDeleteNotificationsPage(selectedIds));
  }, [dispatch, selectedIds]);

  return (
    <div className="shrink-0 border-b border-border bg-card">
      <div className="px-3 md:px-4 lg:px-6 py-3 md:py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold text-foreground">Notifications</h1>
            {unreadCount > 0 && (
              <span
                className={cn(
                  "inline-flex items-center justify-center",
                  "min-w-[24px] h-6 px-2 rounded-full",
                  "text-white text-xs font-bold",
                )}
                style={{ backgroundColor: "var(--status-error)" }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {lastActionMessage && (
              <span className="text-xs text-muted-foreground mr-1">{lastActionMessage}</span>
            )}

            <button
              onClick={handleUndo}
              disabled={!lastActionMessage}
              className={cn(
                "p-2 rounded-md transition-colors",
                lastActionMessage
                  ? "text-primary hover:bg-primary/10"
                  : "text-muted-foreground/30 cursor-not-allowed",
              )}
              title={lastActionMessage ? `Undo: ${lastActionMessage}` : "Undo"}
            >
              <ArrowCounterClockwise size={16} />
            </button>

            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Mark all as read"
              >
                <CheckCircle size={16} />
              </button>
            )}

            <button
              onClick={() => navigate("/settings?section=notifications")}
              className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Notification settings"
            >
              <GearSix size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search notifications..."
              className={cn(
                "w-full h-9 pl-9 pr-9 rounded-lg text-sm",
                "bg-muted/50 border border-border/50",
                "text-foreground placeholder:text-muted-foreground/50",
                "focus:outline-none focus:ring-1 focus:ring-ring focus:border-border",
                "transition-colors",
              )}
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>

          {!isMobile && (
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5 shrink-0">
              <button
                onClick={() => handleViewModeChange("list")}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === "list"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="List view"
              >
                <ListBullets size={16} />
              </button>
              <button
                onClick={() => handleViewModeChange("grouped")}
                className={cn(
                  "p-1.5 rounded transition-colors",
                  viewMode === "grouped"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="Grouped view"
              >
                <SquaresFour size={16} />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border/50 flex-wrap">
          <button
            onClick={() => {
              if (allSelected) {
                dispatch(clearSelection());
              } else {
                dispatch(selectAllOnPage());
              }
            }}
            className={cn(
              "w-4 h-4 rounded border-2 transition-colors flex items-center justify-center shrink-0",
              allSelected
                ? "bg-primary border-primary"
                : someSelected
                  ? "bg-primary/50 border-primary"
                  : "border-border hover:border-primary/60",
            )}
            title={allSelected ? "Deselect all" : "Select all"}
          >
            {(allSelected || someSelected) && (
              <svg className="w-2.5 h-2.5 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                {allSelected ? (
                  <path
                    d="M2 6l3 3 5-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path d="M3 6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                )}
              </svg>
            )}
          </button>

          {hasSelection ? (
            <>
              <span className="text-xs font-medium text-primary">
                {selectedIds.length} selected
              </span>
              <button
                onClick={handleBulkMarkRead}
                disabled={updating}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <Check size={12} weight="bold" />
                Mark read
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={updating}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-400 transition-colors"
              >
                <Trash size={12} />
                Delete
              </button>
              <div className="flex-1" />
              <button
                onClick={() => dispatch(clearSelection())}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </>
          ) : (
            <>
              <div className="w-px h-4 bg-border mx-0.5" />

              <div className="flex items-center gap-0.5">
                {DATE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => handleDatePreset(preset.key)}
                    className={cn(
                      "px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                      activeDatePreset === preset.key
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="w-px h-4 bg-border mx-0.5" />

              <div className="flex items-center gap-1.5">
                <DatePicker
                  value={isoToDatePickerValue(dateFrom)}
                  onChange={handleDateFromChange}
                  placeholder="From"
                  className="w-[140px]"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <DatePicker
                  value={isoToDatePickerValue(dateTo)}
                  onChange={handleDateToChange}
                  placeholder="To"
                  className="w-[140px]"
                />
                {hasCustomDateRange && activeDatePreset === null && (
                  <button
                    onClick={() => handleDatePreset("all")}
                    className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear date range"
                  >
                    <X size={12} weight="bold" />
                  </button>
                )}
              </div>

              <div className="w-px h-4 bg-border mx-0.5" />

              <div className="relative flex items-center">
                {actorSubject && actorId ? (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10">
                    <SubjectAvatar subject={actorSubject} size="xs" />
                    <span className="text-xs font-medium text-primary max-w-[100px] truncate">
                      {actorSubject.name}
                    </span>
                    <button
                      onClick={() => dispatch(setActorFilter(null))}
                      className="p-0.5 rounded text-primary hover:text-primary/70 transition-colors"
                      title="Clear user filter"
                    >
                      <X size={10} weight="bold" />
                    </button>
                  </div>
                ) : (
                  <button
                    ref={userButtonRef}
                    onClick={() => setShowUserPicker(!showUserPicker)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                      showUserPicker
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                  >
                    <User size={14} />
                    From user
                  </button>
                )}
                {showUserPicker && !actorId && (
                  <SubjectPicker
                    mode="single"
                    subjectTypes="users"
                    value={[]}
                    onChange={handleActorSelect}
                    placeholder="Search users..."
                    portal
                    anchorRef={userButtonRef}
                    onClose={() => setShowUserPicker(false)}
                    autoFocus
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
