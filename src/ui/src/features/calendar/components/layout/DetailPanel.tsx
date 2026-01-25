/**
 * DetailPanel - Right sidebar showing event details
 *
 * Contains:
 * - Header with back button and actions
 * - Event title with category color
 * - Event metadata (date, time, recurrence, location)
 * - Attendees list
 * - Categories and tags
 * - Linked resources
 * - Description
 * - Tabs (Outline, Links, Properties)
 */

import { useState, useMemo } from 'react';
import {
  ArrowLeftIcon,
  StarIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { closeDetailPanel } from '../../store';
import { deleteEvent } from '../../store/calendarThunks';
import { useCalendarEvents } from '../../hooks';
import { getCategoryColor } from '../../constants';
import { EventEditor } from '../modals/EventEditor';
import { MarkdownEditor } from '@/components/editor';
import { MentionChipCompact } from '@/features/notes/components/editor/plugins/mention';
import {
  formatDateWithDay,
  formatTimeRange,
  getTimezoneOffset,
} from '../../utils';

/**
 * Extract URN mentions from markdown content.
 * Matches the [[[label|urn]]] format used by UWOS mentions.
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

export function DetailPanel() {
  const dispatch = useAppDispatch();
  const { selectedEvent, toggleFavorite } = useCalendarEvents();
  const displayTimezone = useAppSelector(
    (state) => state.calendarUi.displayTimezone
  );
  const [isEditingOpen, setIsEditingOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'links' | 'properties'>('links');
  const [linksContent, setLinksContent] = useState('');

  // Extract mentions from description to show as linked resources
  // Must be called before early return to respect rules of hooks
  const eventDescription = selectedEvent?.description ?? '';
  const mentionsFromDescription = useMemo(() => {
    if (!eventDescription) return [];
    return extractMentionsFromMarkdown(eventDescription);
  }, [eventDescription]);

  if (!selectedEvent) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>Select an event to view details</p>
      </div>
    );
  }

  const categoryColor = getCategoryColor(selectedEvent.categoryId);
  const timezoneOffset = getTimezoneOffset(displayTimezone);

  const handleBack = () => {
    dispatch(closeDetailPanel());
  };

  const handleToggleFavorite = () => {
    toggleFavorite(selectedEvent.id);
  };

  const handleDelete = async () => {
    await dispatch(deleteEvent(selectedEvent.id));
    dispatch(closeDetailPanel());
    setShowDeleteConfirm(false);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-muted/50 border-b border-border">
        <button
          onClick={handleBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleFavorite}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label={
              selectedEvent.isFavorite
                ? 'Remove from favorites'
                : 'Add to favorites'
            }
          >
            {selectedEvent.isFavorite ? (
              <StarIconSolid className="w-5 h-5 text-yellow-500" />
            ) : (
              <StarIcon className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
          <button
            onClick={() => setIsEditingOpen(true)}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label="Edit event"
          >
            <PencilIcon className="w-5 h-5 text-muted-foreground" />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label="Delete event"
          >
            <TrashIcon className="w-5 h-5 text-red-500" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
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
        <div className="px-5 py-3 space-y-3 border-b border-border">
          {/* Date */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-base">📅</span>
            <span className="text-foreground">
              {formatDateWithDay(selectedEvent.startTime)}
            </span>
          </div>

          {/* Time */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-base">🕐</span>
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
                <span className="text-base">🔄</span>
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
              <span className="text-base">📍</span>
              <span className="text-primary">{selectedEvent.location}</span>
              {selectedEvent.meetingUrl && (
                <span className="text-muted-foreground text-xs">
                  · {new URL(selectedEvent.meetingUrl).hostname}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Attendees */}
        {selectedEvent.attendees.length > 0 && (
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Attendees
            </h3>
            <div className="space-y-3">
              {selectedEvent.attendees.map((attendee) => (
                <div
                  key={attendee.id}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-medium"
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
                    <span
                      className={`text-sm ${
                        attendee.status === 'accepted'
                          ? 'text-green-500'
                          : attendee.status === 'declined'
                          ? 'text-red-500'
                          : attendee.status === 'tentative'
                          ? 'text-yellow-500'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {attendee.status === 'accepted' && '✓'}
                      {attendee.status === 'declined' && '✗'}
                      {attendee.status === 'tentative' && '⏳'}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <button className="mt-3 text-sm text-primary hover:text-primary/80 transition-colors">
              + Add attendees
            </button>
          </div>
        )}

        {/* Tags */}
        {selectedEvent.tags.length > 0 && (
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Tags
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedEvent.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 text-xs rounded bg-primary/15 text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Linked Resources - derived from @mentions in description */}
        {mentionsFromDescription.length > 0 && (
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
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

        {/* Description with markdown and mention rendering */}
        {selectedEvent.description && (
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Description
            </h3>
            <MarkdownEditor
              value={selectedEvent.description}
              onChange={() => {}}
              readonly={true}
              minHeight="auto"
              className="border-none bg-transparent"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="px-5 py-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('links')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'links'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Links
            </button>
            <button
              onClick={() => setActiveTab('properties')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'properties'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Properties
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'links' && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Use @ to reference content.
              </p>
              <MarkdownEditor
                value={linksContent}
                onChange={setLinksContent}
                placeholder="Start typing..."
                minHeight="100px"
                maxHeight="150px"
                showBottomToolbar={true}
              />
            </div>
          )}

          {activeTab === 'properties' && (
            <div className="text-sm text-muted-foreground space-y-2">
              <div className="flex justify-between">
                <span>Created:</span>
                <span>{new Date(selectedEvent.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Modified:</span>
                <span>{new Date(selectedEvent.updatedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Calendar:</span>
                <span>{selectedEvent.calendarId}</span>
              </div>
            </div>
          )}
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
