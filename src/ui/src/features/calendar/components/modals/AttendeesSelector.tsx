import { useState } from 'react';
import { SubjectPicker, SubjectChip, SUBJECT_TYPE, type Subject } from '@/components/subject';
import type { Attendee } from '@/features/calendar/types';

interface AttendeesSelectorProps {
  attendees: Attendee[];
  onAdd: (member: { userId: string; displayName: string; email: string }) => void;
  onRemove: (userId: string) => void;
}

export function AttendeesSelector({ attendees, onAdd, onRemove }: AttendeesSelectorProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const existingIds = attendees.map(a => a.id);

  const handleSelect = (_ids: string[], subjects: Subject[]) => {
    const subject = subjects[0];
    if (!subject || existingIds.includes(subject.id)) return;
    onAdd({
      userId: subject.id,
      displayName: subject.name,
      email: subject.email || '',
    });
  };

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        {isPickerOpen ? (
          <SubjectPicker
            mode="single"
            subjectTypes="all"
            value={existingIds}
            onChange={handleSelect}
            onClose={() => setIsPickerOpen(false)}
            placeholder="Add people or groups..."
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="w-full pl-3 pr-3 py-1.5 text-sm text-left bg-muted/50 border border-border rounded-md text-muted-foreground hover:bg-muted transition-colors"
          >
            Add people or groups...
          </button>
        )}
      </div>

      {/* Selected Attendees Chips */}
      {attendees.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {attendees.map((attendee) => {
            const chipSubject: Subject = {
              id: attendee.id,
              type: SUBJECT_TYPE.USER,
              name: attendee.name || attendee.email,
              email: attendee.email,
            };
            return (
              <SubjectChip
                key={attendee.id}
                subject={chipSubject}
                onRemove={() => onRemove(attendee.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
