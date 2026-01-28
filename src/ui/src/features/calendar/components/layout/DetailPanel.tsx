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

import { useState, useMemo } from 'react';
import {
  CaretDoubleRight,
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
import { closeDetailPanel } from '../../store';
import { deleteEvent } from '../../store/calendarThunks';
import { useCalendarEvents } from '../../hooks';
import { CATEGORY_COLORS } from '../../constants';
import { useBookmarkToggle } from '@/features/bookmarks';
import { EventEditor } from '../modals/EventEditor';
import { MarkdownEditor } from '@/components/editor';
import { MentionChipCompact } from '@/features/notes/components/editor/plugins/mention';
import {
  formatDateWithDay,
  formatTimeRange,
  getTimezoneOffset,
} from '../../utils';
import { findConflicts } from '../../utils/eventPositioning';

/**
 * Extract URN mentions from markdown content.
 * Matches the [[[label|urn]]] format used by Uniffy mentions.
 */
function extractMentionsFromMarkdown(markdown: string): Array<{ label: string; urn: string }> {
  const mentionRegex = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;
  const mentions: Array<{ label: string; urn: string }> = [];
  let match;

  while ((match = mentionRegex.exec(markdown)) !== null) {
    mentions.push({
      label: match[1],
      urn: match[2],
    });
  }

  // Remove duplicates by URN
  const uniqueMentions = mentions.filter(
    (mention, index, self) => self.findIndex((m) => m.urn === mention.urn) === index
  );

  return uniqueMentions;
}

// Default color when category is not found
const DEFAULT_COLOR = CATEGORY_COLORS[0].value; // Blue

export function DetailPanel() {
  const dispatch = useAppDispatch();
  const { selectedEvent, visibleEvents } = useCalendarEvents();
  const displayTimezone = useAppSelector(
    (state) => state.calendarUi.displayTimezone
  );
  const categories = useAppSelector((state) => state.calendar.categories);
  const [isEditingOpen, setIsEditingOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
        <button
          onClick={handleBack}
          className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors"
          title="Close panel"
        >
          <CaretDoubleRight size={16} weight="bold" className="text-primary" />
        </button>
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
            onClick={() => setIsEditingOpen(true)}
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
              <span className="text-foreground">
                {formatTimeRange(
                  selectedEvent.startTime,
                  selectedEvent.endTime
                )}
              </span>
              <span className="text-muted-foreground text-xs">
                ({timezoneOffset})
              </span>
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

          {/* Attendees */}
          {selectedEvent.attendees.length > 0 && (
            <div className="px-5 py-3 border-t border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Attendees
              </h3>
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
                        (organizer)
                      </span>
                    ) : (
                      <span>
                        {attendee.status === 'accepted' && (
                          <Check size={16} weight="bold" className="text-green-500" />
                        )}
                        {attendee.status === 'declined' && (
                          <X size={16} weight="bold" className="text-red-500" />
                        )}
                        {attendee.status === 'tentative' && (
                          <Question size={16} weight="duotone" className="text-yellow-500" />
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
            <div className="px-5 py-3 border-t border-border bg-yellow-50 dark:bg-yellow-900/10">
              <h3 className="text-xs font-semibold text-yellow-800 dark:text-yellow-400 uppercase tracking-wide mb-2 flex items-center gap-2">
                <Warning size={14} weight="duotone" />
                Scheduling Conflicts ({conflictingEvents.length})
              </h3>
              <div className="space-y-2">
                {conflictingEvents.map((conflict) => (
                  <div
                    key={conflict.id}
                    className="flex flex-col gap-1 p-2 rounded-md bg-card border border-yellow-300 dark:border-yellow-700/50"
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
              <p className="mt-2 text-xs text-yellow-700 dark:text-yellow-500">
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
            <MarkdownEditor
              value={selectedEvent.description}
              onChange={() => {}}
              readonly={true}
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

      {/* Event Editor Modal */}
      <EventEditor
        event={selectedEvent}
        isOpen={isEditingOpen}
        onClose={() => setIsEditingOpen(false)}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-96 border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Delete Event?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete "{selectedEvent.title}"? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 text-foreground border border-border rounded-md hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
