/**
 * DetailPanel - Right sidebar showing event details
 *
 * Contains:
 * - Header with back button and actions
 * - Event title with category color
 * - Event metadata (date, time, recurrence, location)
 * - Attendees list
 * - Tags
 * - Referenced content (from @mentions)
 * - Description
 * - Properties (created/modified timestamps)
 */

import { useState, useMemo, useEffect } from 'react';
import {
  SidebarSimple,
  BookmarkSimple,
  PencilSimple,
  Trash,
  CalendarDots,
  Clock,
  ArrowsClockwise,
  MapPin,
  Check,
  X,
  Question,
  Link,
  Info,
  Warning,
} from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { closeDetailPanel, openEditEvent } from '@/features/calendar/store';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { deleteEvent, updateAttendeeStatus } from '@/features/calendar/store/calendarThunks';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { useCalendarEvents } from '@/features/calendar/hooks';
import { CATEGORY_COLORS } from '@/features/calendar/constants';
import { useBookmarkToggle } from '@/features/bookmarks';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@/gen/common/v1/common_pb';
import { MentionChipCompact } from '@/components/editor/plugins/mention';
import {
  formatDateWithDay,
  formatTimeRange,
  getTimezoneOffset,
} from '@/features/calendar/utils';
import { findConflicts } from '@/features/calendar/utils/eventPositioning';
import { extractMentionsFromMarkdown } from '@/shared/utils/mentionUtils';

// Default color when category is not found
const DEFAULT_COLOR = CATEGORY_COLORS[0].value; // Blue

export function DetailPanel() {
  const dispatch = useAppDispatch();
  const { isMobileOrTablet } = useBreakpoint();
  const { selectedEvent, visibleEvents } = useCalendarEvents();
  const displayTimezone = useAppSelector(
    (state) => state.calendarUi.displayTimezone
  );
  const categories = useAppSelector((state) => state.calendar.categories);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Close panel on Escape key
  useEffect(() => {
    if (!selectedEvent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          dispatch(closeDetailPanel());
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedEvent, showDeleteConfirm, dispatch]);

  // Bookmark state - build URN for the event
  const eventUrn = selectedEvent ? `urn:uniffy:content:CALENDAR_EVENT:${selectedEvent.id}` : '';
  const { isBookmarked, toggling: bookmarkToggling, toggle: toggleBookmark } = useBookmarkToggle(eventUrn);

  // Extract mentions from description to show as linked resources
  // Must be called before early return to respect rules of hooks
  const eventDescription = selectedEvent?.description ?? '';
  const mentionsFromDescription = useMemo(() => {
    if (!eventDescription) return [];
    return extractMentionsFromMarkdown(eventDescription);
  }, [eventDescription]);

  // Compute RSVP summary counts (excluding organizer)
  const rsvpSummary = useMemo(() => {
    if (!selectedEvent) return { accepted: 0, declined: 0, tentative: 0, pending: 0 };
    const nonOrganizer = selectedEvent.attendees.filter((a) => a.role !== 'organizer');
    return {
      accepted: nonOrganizer.filter((a) => a.status === 'accepted').length,
      declined: nonOrganizer.filter((a) => a.status === 'declined').length,
      tentative: nonOrganizer.filter((a) => a.status === 'tentative').length,
      pending: nonOrganizer.filter((a) => a.status === 'pending').length,
    };
  }, [selectedEvent]);

  // Current user's attendee record (null if organizer or not an attendee)
  const currentUserAttendee = useMemo(() => {
    if (!selectedEvent || !currentUserId) return null;
    return selectedEvent.attendees.find(
      (a) => a.id === currentUserId && a.role !== 'organizer'
    ) ?? null;
  }, [selectedEvent, currentUserId]);

  const handleRsvp = (status: 'accepted' | 'tentative' | 'declined') => {
    if (!selectedEvent) return;
    dispatch(updateAttendeeStatus({ eventId: selectedEvent.id, status }));
  };

  // Calculate conflicts for the selected event
  const conflictingEvents = useMemo(() => {
    if (!selectedEvent) return [];
    return findConflicts(selectedEvent, visibleEvents);
  }, [selectedEvent, visibleEvents]);

  if (!selectedEvent) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>Select an event to view details</p>
      </div>
    );
  }

  // Look up category color from Redux state (real categories from backend)
  const category = selectedEvent.categoryId ? categories[selectedEvent.categoryId] : null;
  const categoryColor = category?.color ?? DEFAULT_COLOR;
  const timezoneOffset = getTimezoneOffset(displayTimezone);

  const handleBack = () => {
    dispatch(closeDetailPanel());
  };

  const handleDelete = async () => {
    await dispatch(deleteEvent(selectedEvent.id));
    dispatch(closeDetailPanel());
    setShowDeleteConfirm(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        {isMobileOrTablet ? (
          <button
            onClick={handleBack}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Close panel"
          >
            <X size={16} weight="bold" />
          </button>
        ) : (
          <button
            onClick={handleBack}
            className="px-2 py-1 rounded-md text-primary bg-primary/10 transition-colors"
            title="Close panel"
          >
            <SidebarSimple size={16} className="transform -scale-x-100" />
          </button>
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleBookmark}
            disabled={bookmarkToggling}
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors disabled:opacity-50"
            title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            <BookmarkSimple size={20} weight={isBookmarked ? "fill" : "duotone"} className="text-primary" />
          </button>
          <button
            onClick={() => dispatch(openEditEvent(selectedEvent.id))}
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Edit event"
          >
            <PencilSimple size={20} weight="duotone" className="text-primary" />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 rounded-md bg-transparent hover:bg-muted transition-colors"
            title="Delete event"
          >
            <Trash size={20} weight="duotone" className="text-red-500" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Event Details Section */}
        <div className="border-b border-border">
          {/* Event Title */}
          <div className="px-5 py-4 flex items-start gap-3">
            <div
              className="w-1 h-8 rounded-full shrink-0"
              style={{ backgroundColor: categoryColor }}
            />
            <h2 className="text-lg font-semibold text-foreground">
              {selectedEvent.title}
            </h2>
          </div>

          {/* Event Metadata */}
          <div className="px-5 pb-4 space-y-2.5">
            {/* Date */}
            <div className="flex items-center gap-3 text-sm">
              <CalendarDots size={16} weight="duotone" className="text-muted-foreground" />
              <span className="text-foreground">
                {formatDateWithDay(selectedEvent.startTime)}
              </span>
            </div>

            {/* Time */}
            <div className="flex items-center gap-3 text-sm">
              <Clock size={16} weight="duotone" className="text-muted-foreground" />
              {selectedEvent.isAllDay ? (
                <span className="text-foreground">All day</span>
              ) : (
                <>
                  <span className="text-foreground">
                    {formatTimeRange(
                      selectedEvent.startTime,
                      selectedEvent.endTime
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    ({timezoneOffset})
                  </span>
                </>
              )}
            </div>

            {/* Recurrence */}
            {selectedEvent.recurrence &&
              selectedEvent.recurrence.pattern !== 'none' && (
                <div className="flex items-center gap-3 text-sm">
                  <ArrowsClockwise size={16} weight="duotone" className="text-muted-foreground" />
                  <span className="text-foreground">
                    {selectedEvent.recurrence.pattern === 'weekly'
                      ? 'Every week'
                      : selectedEvent.recurrence.pattern}
                  </span>
                  {selectedEvent.recurrence.endDate && (
                    <span className="text-muted-foreground text-xs">
                      · Ends {selectedEvent.recurrence.endDate}
                    </span>
                  )}
                </div>
              )}

            {/* Location */}
            {selectedEvent.location && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin size={16} weight="duotone" className="text-muted-foreground" />
                <span className="text-primary">{selectedEvent.location}</span>
                {selectedEvent.meetingUrl && (
                  <span className="text-muted-foreground text-xs">
                    · {new URL(selectedEvent.meetingUrl).hostname}
                  </span>
                )}
              </div>
            )}

            {/* Tags inline */}
            {selectedEvent.tags.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                {selectedEvent.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded bg-primary/15 text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* RSVP Action Bar (for non-organizer attendees) */}
          {currentUserAttendee && (
            <div className="px-5 py-3 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Your Response
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRsvp('accepted')}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    currentUserAttendee.status === 'accepted'
                      ? 'status-success border'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => handleRsvp('tentative')}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    currentUserAttendee.status === 'tentative'
                      ? 'status-warning border'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  Maybe
                </button>
                <button
                  type="button"
                  onClick={() => handleRsvp('declined')}
                  className={cn(
                    'flex-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                    currentUserAttendee.status === 'declined'
                      ? 'status-error border'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Attendees */}
          {selectedEvent.attendees.length > 0 && (
            <div className="px-5 py-3 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Attendees
              </h3>
              {/* RSVP Summary */}
              {(rsvpSummary.accepted > 0 || rsvpSummary.declined > 0 || rsvpSummary.tentative > 0 || rsvpSummary.pending > 0) && (
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {rsvpSummary.accepted > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium status-success">
                      <Check size={12} weight="bold" />
                      {rsvpSummary.accepted}
                    </span>
                  )}
                  {rsvpSummary.declined > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium status-error">
                      <X size={12} weight="bold" />
                      {rsvpSummary.declined}
                    </span>
                  )}
                  {rsvpSummary.tentative > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium status-warning">
                      <Question size={12} weight="bold" />
                      {rsvpSummary.tentative}
                    </span>
                  )}
                  {rsvpSummary.pending > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                      {rsvpSummary.pending} pending
                    </span>
                  )}
                </div>
              )}
              <div className="space-y-2">
                {selectedEvent.attendees.map((attendee) => (
                  <div
                    key={attendee.id}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium"
                        style={{
                          backgroundColor:
                            attendee.role === 'organizer'
                              ? '#3B82F6'
                              : '#8B5CF6',
                        }}
                      >
                        {attendee.initials}
                      </div>
                      <span className="text-sm text-foreground">
                        {attendee.name}
                      </span>
                    </div>
                    {attendee.role === 'organizer' ? (
                      <span className="text-xs text-muted-foreground">
                        Organizer
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        {attendee.status === 'accepted' && (
                          <>
                            <Check size={14} weight="bold" style={{ color: 'var(--status-success)' }} />
                            <span className="text-xs" style={{ color: 'var(--status-success)' }}>Accepted</span>
                          </>
                        )}
                        {attendee.status === 'declined' && (
                          <>
                            <X size={14} weight="bold" style={{ color: 'var(--status-error)' }} />
                            <span className="text-xs" style={{ color: 'var(--status-error)' }}>Declined</span>
                          </>
                        )}
                        {attendee.status === 'tentative' && (
                          <>
                            <Question size={14} weight="bold" style={{ color: 'var(--status-warning)' }} />
                            <span className="text-xs" style={{ color: 'var(--status-warning)' }}>Maybe</span>
                          </>
                        )}
                        {attendee.status === 'pending' && (
                          <span className="text-xs text-muted-foreground">Pending</span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conflicts Warning */}
          {conflictingEvents.length > 0 && (
            <div className="px-5 py-3 border-t border-border" style={{ backgroundColor: 'color-mix(in srgb, var(--status-warning) 5%, transparent)' }}>
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-2" style={{ color: 'var(--status-warning)' }}>
                <Warning size={14} weight="duotone" />
                Scheduling Conflicts ({conflictingEvents.length})
              </h3>
              <div className="space-y-2">
                {conflictingEvents.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="flex flex-col gap-1 p-2 rounded-md bg-card border"
                    style={{ borderColor: 'color-mix(in srgb, var(--status-warning) 30%, transparent)' }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {conflict.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock size={12} weight="duotone" />
                      <span>
                        {formatTimeRange(conflict.startTime, conflict.endTime)}
                      </span>
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
              <p className="mt-2 text-xs" style={{ color: 'var(--status-warning)' }}>
                These events overlap with the current event's time slot. Consider rescheduling to avoid conflicts.
              </p>
            </div>
          )}
        </div>

        {/* Description Section - Takes most of the space with large min-height */}
        <div className="min-h-[50vh] px-5 py-4 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Description
          </h3>
          {selectedEvent.description ? (
            <CrepeEditor
              contentType={ContentType.CALENDAR_EVENT}
              contentId={selectedEvent.id}
              value={selectedEvent.description}
              readonly
              enableUpload={false}
              compact
              minHeight="calc(50vh - 60px)"
              className="border-none bg-transparent"
            />
          ) : (
            <p className="text-sm text-muted-foreground italic">No description</p>
          )}
        </div>

        {/* Referenced Content Section */}
        {mentionsFromDescription.length > 0 && (
          <div className="px-5 py-4 border-b border-border">
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

        {/* Properties Section */}
        <div className="px-5 py-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Info size={14} weight="duotone" />
            Properties
          </h3>
          <div className="text-sm text-muted-foreground space-y-1.5">
            <div className="flex justify-between">
              <span>Created:</span>
              <span>{new Date(selectedEvent.createdAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Modified:</span>
              <span>{new Date(selectedEvent.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-[calc(100vw-2rem)] max-w-96 border border-border p-4 md:p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Event?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete "{selectedEvent.title}"? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="md" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Button>
              <Button variant="destructive" size="md" className="flex-1" onClick={handleDelete}>
                Delete
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
