import { useState, useMemo, useEffect, useCallback } from "react";
import {
  BookmarkSimple,
  ShareNetwork,
  Trash,
  X,
  Link,
  Warning,
  Clock,
  MapPin,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { deselectEvent } from "@/features/calendar/store";
import { deleteEvent as deleteEventThunk } from "@/features/calendar/store/calendarThunks";
import { RecurrenceEditScopeDialog } from "@/features/calendar/components/modals/RecurrenceEditScopeDialog";
import type { RecurrenceEditScope } from "@/features/calendar/types";
import { Button } from "@/components/ui/button";
import { useCalendarEvents } from "@/features/calendar/hooks";
import { useEventCommit } from "@/features/calendar/hooks/useEventCommit";
import { useEventPermission } from "@/features/calendar/hooks/useEventPermission";
import { useAccessPolicyDialog } from "@/features/permissions";
import { ACCENT_EVENT_COLOR } from "@/features/calendar/constants";
import { useBookmarkToggle } from "@/features/bookmarks";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { MentionChipCompact } from "@/components/mention";
import { formatTimeRange } from "@/features/calendar/utils";
import { findConflicts } from "@/features/calendar/utils/eventPositioning";
import { extractMentionsFromMarkdown } from "@/shared/utils/mentionUtils";
import { InlineTextField } from "@/features/calendar/components/detail/InlineTextField";
import { EventScheduleSection } from "@/features/calendar/components/detail/EventScheduleSection";
import { EventPlaceSection } from "@/features/calendar/components/detail/EventPlaceSection";
import { EventPeopleSection } from "@/features/calendar/components/detail/EventPeopleSection";
import { EventMetaSection } from "@/features/calendar/components/detail/EventMetaSection";
import { EventActivityLog } from "@/features/calendar/components/detail/EventActivityLog";

export function EventDetailModal() {
  const dispatch = useAppDispatch();
  const { selectedEvent, visibleEvents } = useCalendarEvents();
  const categories = useAppSelector((state) => state.calendar.categories);
  const isLoadingDetail = useAppSelector((state) => state.calendar.loading.eventDetail);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteScopeDialog, setShowDeleteScopeDialog] = useState(false);

  const { canEdit, canDelete, canManage } = useEventPermission(selectedEvent);
  const { openFor: openAccessPolicyDialog } = useAccessPolicyDialog();
  const { commit, pendingPatch, resolveScope, cancelScope, isRecurring } =
    useEventCommit(selectedEvent);

  const eventUrn = selectedEvent ? `urn:uniffy:content:CALENDAR_EVENT:${selectedEvent.id}` : "";
  const {
    isBookmarked,
    toggling: bookmarkToggling,
    toggle: toggleBookmark,
  } = useBookmarkToggle(eventUrn);

  const handleClose = useCallback(() => {
    dispatch(deselectEvent());
  }, [dispatch]);

  // Called before the early return so hook order stays stable across renders.
  const eventDescription = selectedEvent?.description ?? "";
  const mentionsFromDescription = useMemo(() => {
    if (!eventDescription) return [];
    return extractMentionsFromMarkdown(eventDescription);
  }, [eventDescription]);

  const conflictingEvents = useMemo(() => {
    if (!selectedEvent) return [];
    return findConflicts(selectedEvent, visibleEvents);
  }, [selectedEvent, visibleEvents]);

  // Escape unwinds the innermost surface first so a nested dialog is not skipped.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingPatch) {
        cancelScope();
      } else if (showDeleteScopeDialog) {
        setShowDeleteScopeDialog(false);
      } else if (showDeleteConfirm) {
        setShowDeleteConfirm(false);
      } else {
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDeleteConfirm, showDeleteScopeDialog, pendingPatch, cancelScope, handleClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const category = selectedEvent?.categoryId ? categories[selectedEvent.categoryId] : null;
  const categoryColor = category?.color ?? ACCENT_EVENT_COLOR;

  const handleDeleteClick = () => {
    if (isRecurring) {
      setShowDeleteScopeDialog(true);
    } else {
      setShowDeleteConfirm(true);
    }
  };

  const handleDelete = async () => {
    if (!selectedEvent) return;
    await dispatch(deleteEventThunk({ eventId: selectedEvent.id }));
    setShowDeleteConfirm(false);
    handleClose();
  };

  const handleDeleteScopeSelect = async (scope: RecurrenceEditScope) => {
    if (!selectedEvent) return;
    setShowDeleteScopeDialog(false);
    await dispatch(
      deleteEventThunk({
        eventId: selectedEvent.id,
        recurrenceEditScope: scope,
        occurrenceDate: selectedEvent.occurrenceDate,
      }),
    );
    handleClose();
  };

  const handleDescriptionDone = (markdown: string) => {
    if (!selectedEvent) return;
    // Trim-compare because the editor re-serializes markdown and can differ by trailing newlines alone.
    if (markdown.trim() === selectedEvent.description.trim()) return;
    commit({ description: markdown });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Event details"
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative bg-background w-[calc(100vw-2rem)] max-w-3xl rounded-t-xl sm:rounded-xl shadow-2xl border border-border overflow-hidden max-h-[85vh] flex flex-col min-h-0">
        {!selectedEvent ? (
          // The modal opens on selection, so a missing row means the deep-link
          // fetch is still in flight or the event is not reachable.
          <div className="flex flex-col items-center justify-center gap-4 py-16 text-muted-foreground">
            <p>{isLoadingDetail ? "Loading event..." : "This event is unavailable."}</p>
            {!isLoadingDetail && (
              <Button variant="outline" size="md" onClick={handleClose}>
                Close
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 px-4 py-2 border-b border-border">
              <button
                onClick={toggleBookmark}
                disabled={bookmarkToggling}
                className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
                title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
              >
                <BookmarkSimple
                  size={20}
                  weight={isBookmarked ? "fill" : "duotone"}
                  className="text-primary"
                />
              </button>
              {canManage && (
                <button
                  onClick={() =>
                    openAccessPolicyDialog(
                      ContentType.CALENDAR_EVENT,
                      selectedEvent.id,
                      selectedEvent.title,
                      selectedEvent.userRole,
                    )
                  }
                  className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
                  title="Share"
                >
                  <ShareNetwork size={20} weight="duotone" className="text-primary" />
                </button>
              )}
              {canDelete && (
                <button
                  onClick={handleDeleteClick}
                  className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
                  title="Delete event"
                >
                  <Trash size={20} weight="duotone" className="text-red-500" />
                </button>
              )}
              <button
                onClick={handleClose}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Close"
                aria-label="Close event details"
              >
                <X size={20} weight="bold" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 py-4 flex items-start gap-3 border-b border-border">
                <div
                  className="w-1 h-8 rounded-full shrink-0"
                  style={{ backgroundColor: categoryColor }}
                />
                <div className="flex-1 min-w-0">
                  <InlineTextField
                    value={selectedEvent.title}
                    onCommit={(title) => commit({ title })}
                    placeholder="Untitled event"
                    readOnly={!canEdit}
                    required
                    className="text-lg"
                    inputClassName="text-lg font-semibold"
                  />
                </div>
              </div>

              <div className="px-5 py-3 border-b border-border">
                <EventScheduleSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              <div className="px-5 py-3 border-b border-border">
                <EventPlaceSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              <div className="px-5 py-3 border-b border-border">
                <EventMetaSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              {selectedEvent.attendees.length > 0 && (
                <div className="px-5 py-3 border-b border-border">
                  <EventPeopleSection event={selectedEvent} canEdit={canEdit} commit={commit} />
                </div>
              )}

              {conflictingEvents.length > 0 && (
                <div
                  className="px-5 py-3 border-b border-border"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--status-warning) 5%, transparent)",
                  }}
                >
                  <h3
                    className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-2"
                    style={{ color: "var(--status-warning)" }}
                  >
                    <Warning size={14} weight="duotone" />
                    Scheduling Conflicts ({conflictingEvents.length})
                  </h3>
                  <div className="space-y-2">
                    {conflictingEvents.map((conflict) => (
                      <div
                        key={conflict.id}
                        className="flex flex-col gap-1 p-2 rounded-md bg-card border"
                        style={{
                          borderColor: "color-mix(in srgb, var(--status-warning) 30%, transparent)",
                        }}
                      >
                        <span className="text-sm font-medium text-foreground truncate">
                          {conflict.title}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock size={12} weight="duotone" />
                          <span>{formatTimeRange(conflict.startTime, conflict.endTime)}</span>
                        </div>
                        {conflict.location && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <MapPin size={12} weight="duotone" />
                            <span className="truncate">{conflict.location}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-3 border-b border-border">
                <ExpandableEditor
                  contentType={ContentType.CALENDAR_EVENT}
                  contentId={selectedEvent.id}
                  value={selectedEvent.description}
                  onDone={handleDescriptionDone}
                  placeholder="Click to add a description... (type @ to mention)"
                  label="Description"
                  enableUpload
                  fullPreview
                  previewMaxHeight="400px"
                  showHeader
                  readonly={!canEdit}
                />
              </div>

              {mentionsFromDescription.length > 0 && (
                <div className="px-5 py-3 border-b border-border">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Link size={14} weight="duotone" />
                    Referenced Content
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {mentionsFromDescription.map((mention) => (
                      <MentionChipCompact
                        key={mention.urn}
                        urn={mention.urn}
                        label={mention.label}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-4">
                <EventActivityLog eventId={selectedEvent.id} />
              </div>
            </div>
          </>
        )}
      </div>

      {showDeleteConfirm && selectedEvent && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-[calc(100vw-2rem)] max-w-96 border border-border p-4 md:p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Event?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete &quot;{selectedEvent.title}&quot;? This action cannot
              be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" size="md" className="flex-1" onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        </>
      )}

      <RecurrenceEditScopeDialog
        isOpen={showDeleteScopeDialog}
        onClose={() => setShowDeleteScopeDialog(false)}
        onSelect={handleDeleteScopeSelect}
        action="delete"
      />

      <RecurrenceEditScopeDialog
        isOpen={pendingPatch !== null}
        onClose={cancelScope}
        onSelect={resolveScope}
        action="edit"
      />
    </div>
  );
}
