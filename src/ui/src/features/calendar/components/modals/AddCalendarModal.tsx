/**
 * Add Calendar Modal
 * Dialog for creating a new calendar
 */

import { useState } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { createCalendar, updateCalendarThunk } from '../../store';
import { cn } from '@/utils/cn';

interface AddCalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CALENDAR_COLORS = [
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
];

export function AddCalendarModal({ isOpen, onClose }: AddCalendarModalProps) {
  const dispatch = useAppDispatch();
  const calendars = useAppSelector((state) => state.calendar.calendars);
  const editingCalendarId = useAppSelector((state) => state.calendarUi.editingCalendarId);
  const isLoading = useAppSelector((state) => state.calendar.loading.calendars);

  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(CALENDAR_COLORS[0]);

  // Reset form when modal opens or editing target changes (render-time state adjustment)
  const [formKey, setFormKey] = useState('');
  const currentFormKey = isOpen ? `open-${editingCalendarId ?? 'new'}` : 'closed';
  if (currentFormKey !== formKey) {
    setFormKey(currentFormKey);
    if (isOpen) {
      if (editingCalendarId && calendars[editingCalendarId]) {
        const calendar = calendars[editingCalendarId];
        setName(calendar.name);
        setSelectedColor(calendar.color);
      } else {
        setName('');
        setSelectedColor(CALENDAR_COLORS[0]);
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    try {
      if (editingCalendarId) {
        await dispatch(updateCalendarThunk({
          calendarId: editingCalendarId,
          name: name.trim(),
          color: selectedColor,
        })).unwrap();
      } else {
        await dispatch(createCalendar({
          name: name.trim(),
          color: selectedColor,
          type: 'personal',
          isDefault: false,
        })).unwrap();
      }

      onClose();
    } catch (error) {
      console.error('Failed to save calendar:', error);
    }
  };

  if (!isOpen) return null;

  const isEditing = !!editingCalendarId;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-96 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? 'Edit Calendar' : 'New Calendar'}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name Input */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Calendar Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Work, Personal, Travel"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Color
            </label>
            <div className="flex gap-2 flex-wrap">
              {CALENDAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={cn(
                    'w-8 h-8 rounded-full transition-all',
                    selectedColor === color
                      ? 'ring-2 ring-offset-2 ring-offset-background ring-primary'
                      : 'hover:opacity-80'
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-foreground border border-border rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={cn(
                'flex-1 px-4 py-2 rounded-md font-medium transition-colors',
                name.trim() && !isLoading
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
              disabled={!name.trim() || isLoading}
            >
              {isLoading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
