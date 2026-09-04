import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Bell,
  Check,
  CheckCircle,
  GearSix,
  ListBullets,
  SquaresFour,
  Trash,
  User,
  X,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { DatePicker } from "@/components/ui/date-picker";
import {
  PaneHeader,
  PaneHeaderBar,
  PaneHeaderControls,
  PaneIconButton,
} from "@/components/ui/pane-header";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
    (value: string) => {
      dispatch(setPageSearchQuery(value));
    },
    [dispatch],
  );

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
    <PaneHeader>
      <PaneHeaderBar
        icon={Bell}
        divided
        title={
          <>
            Notifications
            {unreadCount > 0 && (
              <span
                className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
                style={{ backgroundColor: "var(--status-error)" }}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </>
        }
      >
        {!isMobile && (
          <SearchField
            size="sm"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search notifications..."
            containerClassName="w-64"
          />
        )}
        {!isMobile && (
          <SegmentedControl
            value={viewMode}
            onChange={handleViewModeChange}
            ariaLabel="View"
            options={[
              { value: "list", content: <ListBullets size={14} />, title: "List view" },
              { value: "grouped", content: <SquaresFour size={14} />, title: "Grouped view" },
            ]}
          />
        )}
        {lastActionMessage && (
          <span className="hidden text-xs text-muted-foreground md:inline">
            {lastActionMessage}
          </span>
        )}
        <PaneIconButton
          onClick={handleUndo}
          disabled={!lastActionMessage}
          active={Boolean(lastActionMessage)}
          title={lastActionMessage ? `Undo: ${lastActionMessage}` : "Undo"}
        >
          <ArrowCounterClockwise size={16} />
        </PaneIconButton>
        {unreadCount > 0 && (
          <PaneIconButton onClick={handleMarkAllRead} title="Mark all as read">
            <CheckCircle size={16} />
          </PaneIconButton>
        )}
        <PaneIconButton
          onClick={() => navigate("/settings?section=notifications")}
          title="Notification settings"
        >
          <GearSix size={16} />
        </PaneIconButton>
      </PaneHeaderBar>

      <PaneHeaderControls>
        {isMobile && (
          <SearchField
            size="sm"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search notifications..."
            containerClassName="w-full"
          />
        )}

        <button
          type="button"
          onClick={() => {
            if (allSelected) {
              dispatch(clearSelection());
            } else {
              dispatch(selectAllOnPage());
            }
          }}
          className={cn(
            "focus-ring flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors",
            allSelected
              ? "border-primary bg-primary"
              : someSelected
                ? "border-primary bg-primary/50"
                : "border-border bg-input hover:border-border-strong",
          )}
          title={allSelected ? "Deselect all" : "Select all"}
        >
          {(allSelected || someSelected) && (
            <svg className="h-2.5 w-2.5 text-primary-foreground" viewBox="0 0 12 12" fill="none">
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
            <span className="text-xs font-medium text-primary">{selectedIds.length} selected</span>
            <button
              type="button"
              onClick={handleBulkMarkRead}
              disabled={updating}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Check size={12} weight="bold" />
              Mark read
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={updating}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
            >
              <Trash size={12} />
              Delete
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => dispatch(clearSelection())}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />

            <div className="flex items-center gap-0.5">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => handleDatePreset(preset.key)}
                  className={cn(
                    "h-7 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors",
                    activeDatePreset === preset.key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="mx-0.5 h-4 w-px bg-border" />

            <div className="flex items-center gap-1.5">
              <DatePicker
                size="sm"
                value={isoToDatePickerValue(dateFrom)}
                onChange={handleDateFromChange}
                placeholder="From"
                className="w-[128px]"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <DatePicker
                size="sm"
                value={isoToDatePickerValue(dateTo)}
                onChange={handleDateToChange}
                placeholder="To"
                className="w-[128px]"
              />
              {hasCustomDateRange && activeDatePreset === null && (
                <button
                  type="button"
                  onClick={() => handleDatePreset("all")}
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                  title="Clear date range"
                >
                  <X size={12} weight="bold" />
                </button>
              )}
            </div>

            <div className="mx-0.5 h-4 w-px bg-border" />

            <div className="relative flex items-center">
              {actorSubject && actorId ? (
                <div className="flex h-7 items-center gap-1.5 rounded-md bg-primary/10 px-2">
                  <SubjectAvatar subject={actorSubject} size="xs" />
                  <span className="max-w-[100px] truncate text-xs font-medium text-primary">
                    {actorSubject.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => dispatch(setActorFilter(null))}
                    className="rounded p-0.5 text-primary transition-colors hover:text-primary/70"
                    title="Clear user filter"
                  >
                    <X size={10} weight="bold" />
                  </button>
                </div>
              ) : (
                <button
                  ref={userButtonRef}
                  type="button"
                  onClick={() => setShowUserPicker(!showUserPicker)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors",
                    showUserPicker
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
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
      </PaneHeaderControls>
    </PaneHeader>
  );
}
