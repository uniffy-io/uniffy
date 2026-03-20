/**
 * Create Template Modal
 * Dialog for creating a new event template
 */

import { useState, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { createEventTemplate, updateEventTemplate } from '@/features/calendar/store/calendarThunks';
import { VisibilityScope } from '@uniffy/proto/common/v1/common_pb';

interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateTemplateModal({ isOpen, onClose }: CreateTemplateModalProps) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.calendar.categories);
  const templates = useAppSelector((state) => state.calendar.templates);
  const editingTemplateId = useAppSelector((state) => state.calendarUi.editingTemplateId);
  const isLoading = useAppSelector((state) => state.calendar.loading.templates);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [duration, setDuration] = useState(60); // minutes
  const [location, setLocation] = useState('');

  // Reset form when modal opens or editing target changes (render-time state adjustment)
  const [formKey, setFormKey] = useState('');
  const currentFormKey = isOpen ? `open-${editingTemplateId ?? 'new'}` : 'closed';
  if (currentFormKey !== formKey) {
    setFormKey(currentFormKey);
    if (isOpen) {
      if (editingTemplateId && templates[editingTemplateId]) {
        const t = templates[editingTemplateId];
        setName(t.title);
        setDescription(t.description || '');
        setSelectedCategoryId(t.categoryId || '');
        setDuration(t.durationMinutes || 60);
        setLocation(t.location || '');
      } else {
        setName('');
        setDescription('');
        setSelectedCategoryId('');
        setDuration(60);
        setLocation('');
      }
    }
  }

  useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    try {
        if (editingTemplateId) {
            await dispatch(updateEventTemplate({
                id: editingTemplateId,
                title: name.trim(),
                description,
                durationMinutes: duration,
                categoryId: selectedCategoryId || undefined,
                location,
            })).unwrap();
        } else {
            await dispatch(createEventTemplate({
                title: name.trim(),
                description,
                durationMinutes: duration,
                categoryId: selectedCategoryId || undefined,
                location,
                meetingUrl: '', 
                visibility: VisibilityScope.PRIVATE,
                tags: [],
            })).unwrap();
        }

        onClose();
    } catch (error) {
        console.error('Failed to save template:', error);
    }
  };

  if (!isOpen) return null;

  const categoryArray = Object.values(categories);
  const isEditing = !!editingTemplateId;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-background rounded-lg shadow-lg z-50 w-[calc(100vw-2rem)] max-w-96 border border-border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? 'Edit Template' : 'New Template'}
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
              Template Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Daily Standup, Code Review"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add notes about this template..."
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          {/* Location */}
          <div>
             <label className="block text-sm font-medium text-foreground mb-1">
               Location (optional)
             </label>
             <input
               type="text"
               value={location}
               onChange={(e) => setLocation(e.target.value)}
               placeholder="e.g. Conference Room A or Zoom Link"
               className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
             />
          </div>
          
          {/* Category Selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Category
            </label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {categoryArray.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Default Duration (minutes)
            </label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              min="15"
              step="15"
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-4 border-t border-border">
            <Button variant="outline" size="md" className="flex-1" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" size="md" className="flex-1" loading={isLoading} disabled={!name.trim() || isLoading}>
              {isLoading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create')}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
