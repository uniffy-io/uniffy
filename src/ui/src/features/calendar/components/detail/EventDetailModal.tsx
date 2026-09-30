import { useState, useMemo, useCallback } from "react";
import {
  BookmarkSimple,
  ShareNetwork,
  DownloadSimple,
  Trash,
  Link,
  Warning,
  Clock,
  MapPin,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { deselectEvent } from "@/features/calendar/store";
import { updateEvent as patchEventLocal } from "@/features/calendar/store/calendarSlice";
import { eventSupportsRealtime } from "@/features/calendar/utils/realtimeEligibility";
import {
  deleteEvent as deleteEventThunk,
  exportEvent,
} from "@/features/calendar/store/calendarThunks";
import { RecurrenceEditScopeDialog } from "@/features/calendar/components/modals/RecurrenceEditScopeDialog";
import type { RecurrenceEditScope } from "@/features/calendar/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { useCalendarEvents } from "@/features/calendar/hooks";
import { useEventCommit } from "@/features/calendar/hooks/useEventCommit";
import { useEventPermission } from "@/features/calendar/hooks/useEventPermission";
import { useAccessPolicyDialog } from "@/features/permissions";
import { ACCENT_EVENT_COLOR } from "@/features/calendar/constants";
import { useBookmarkStatuses, useBookmarkToggle } from "@/features/bookmarks";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { MentionChipCompact } from "@/components/mention";
import { formatTimeRange, masterEventId } from "@/features/calendar/utils";
import { findConflicts } from "@/features/calendar/utils/eventPositioning";
import { extractMentionsFromMarkdown } from "@/shared/utils/mentionUtils";
import { InlineTextField } from "@/features/calendar/components/detail/InlineTextField";
import { EventScheduleSection } from "@/features/calendar/components/detail/EventScheduleSection";
import { EventPlaceSection } from "@/features/calendar/components/detail/EventPlaceSection";
import { EventPeopleSection } from "@/features/calendar/components/detail/EventPeopleSection";
import { EventMetaSection } from "@/features/calendar/components/detail/EventMetaSection";
import { EventStateSection } from "@/features/calendar/components/detail/EventStateSection";
import { EventSchedulingSection } from "@/features/calendar/components/detail/EventSchedulingSection";
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
  // Attachments and sharing live on the series row; an expanded occurrence id is not a UUID.
  const seriesEventId = selectedEvent ? masterEventId(selectedEvent.id) : "";
  useBookmarkStatuses(eventUrn ? [eventUrn] : []);
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

  const handleDescriptionDone = (
    markdown: string,
    { realtimeOwned }: { realtimeOwned: boolean },
  ) => {
    if (!selectedEvent) return;
    if (realtimeOwned) {
      dispatch(patchEventLocal({ ...selectedEvent, description: markdown }));
      return;
    }
    // Trim-compare because the editor re-serializes markdown and can differ by trailing newlines alone.
    if (markdown.trim() === selectedEvent.description.trim()) return;
    commit({ description: markdown });
  };

  return (
    <>
      <Modal onClose={handleClose} maxWidth="max-w-3xl" className="flex flex-col max-h-[85dvh]">
        {!selectedEvent ? (
          // The modal opens on selection, so a missing row means the deep-link
          // fetch is still in flight or the event is not reachable.
          <>
            <ModalBody scrollable={false} className="py-16 text-center text-muted-foreground">
              <p>{isLoadingDetail ? "Loading event..." : "This event is unavailable."}</p>
            </ModalBody>
            {!isLoadingDetail && (
              <ModalFooter>
                <Button type="button" variant="ghost" onClick={handleClose}>
                  Close
                </Button>
              </ModalFooter>
            )}
          </>
        ) : selectedEvent.detailsHidden ? (
          // Server-redacted private event: an honest busy block, nothing more.
          // The activity log and description are not fetched or rendered.
          <>
            <ModalHeader
              title={selectedEvent.isOutOfOffice ? "Out of office" : "Busy"}
              description="This event is private. Its details are hidden."
            />
            <ModalBody scrollable={false}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock size={14} weight="duotone" />
                <span>{formatTimeRange(selectedEvent.startTime, selectedEvent.endTime)}</span>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button type="button" variant="ghost" onClick={handleClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader
              title={
                <span className="flex items-start gap-3 whitespace-normal">
                  <span
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: categoryColor }}
                  />
                  <span className="flex-1 min-w-0">
                    <InlineTextField
                      value={selectedEvent.title}
                      onCommit={(title) => commit({ title })}
                      placeholder="Untitled event"
                      readOnly={!canEdit}
                      required
                      textClassName={cn(
                        "text-xl font-semibold",
                        selectedEvent.status === "cancelled" && "line-through opacity-60",
                      )}
                      inputClassName="text-xl font-semibold"
                    />
                    {selectedEvent.status === "cancelled" && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs font-normal rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        Cancelled
                      </span>
                    )}
                  </span>
                </span>
              }
              actions={
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={toggleBookmark}
                    disabled={bookmarkToggling}
                    title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
                    aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
                  >
                    <BookmarkSimple
                      size={18}
                      weight={isBookmarked ? "fill" : "duotone"}
                      className="text-primary"
                    />
                  </Button>
                  {canManage && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        openAccessPolicyDialog(
                          ContentType.CALENDAR_EVENT,
                          seriesEventId,
                          selectedEvent.title,
                          selectedEvent.userRole,
                        )
                      }
                      title="Share"
                      aria-label="Share"
                    >
                      <ShareNetwork size={18} weight="duotone" className="text-primary" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void dispatch(exportEvent(selectedEvent.id))}
                    title="Download as .ics"
                    aria-label="Download as .ics"
                  >
                    <DownloadSimple size={18} weight="duotone" className="text-primary" />
                  </Button>
                  {canDelete && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleDeleteClick}
                      title="Delete event"
                      aria-label="Delete event"
                    >
                      <Trash size={18} weight="duotone" className="text-red-500" />
                    </Button>
                  )}
                </div>
              }
              onClose={handleClose}
            />

            <ModalBody scrollable={false} className="flex-1 min-h-0 overflow-y-auto p-0 space-y-0">
              <div className="px-6 py-3 border-b border-border">
                <EventScheduleSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              {selectedEvent.attendees.length > 0 && (
                <div className="px-6 py-3 border-b border-border">
                  <EventSchedulingSection event={selectedEvent} canEdit={canEdit} commit={commit} />
                </div>
              )}

              <div className="px-6 py-3 border-b border-border">
                <EventPlaceSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              <div className="px-6 py-3 border-b border-border">
                <EventStateSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              <div className="px-6 py-3 border-b border-border">
                <EventMetaSection event={selectedEvent} canEdit={canEdit} commit={commit} />
              </div>

              {selectedEvent.attendees.length > 0 && (
                <div className="px-6 py-3 border-b border-border">
                  <EventPeopleSection event={selectedEvent} canEdit={canEdit} commit={commit} />
                </div>
              )}

              {conflictingEvents.length > 0 && (
                <div
                  className="px-6 py-3 border-b border-border"
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

              <div className="px-6 py-3 border-b border-border">
                <ExpandableEditor
                  key={selectedEvent.id}
                  contentType={ContentType.CALENDAR_EVENT}
                  contentId={seriesEventId}
                  value={selectedEvent.description}
                  realtime={eventSupportsRealtime(selectedEvent)}
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
                <div className="px-6 py-3 border-b border-border">
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

              <div className="px-6 py-4">
                <EventActivityLog eventId={selectedEvent.id} />
              </div>
            </ModalBody>
          </>
        )}
      </Modal>

      {selectedEvent && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
          title="Delete event?"
          message={
            <>
              Are you sure you want to delete &quot;{selectedEvent.title}&quot;? This action cannot
              be undone.
            </>
          }
          confirmLabel="Delete"
          variant="danger"
        />
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
    </>
  );
}
