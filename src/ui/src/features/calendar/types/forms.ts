/**
 * Form type definitions for event creation/editing
 */

import { z } from 'zod';
import type { RecurrencePattern, DayOfWeek } from '@/features/calendar/types/event';

/**
 * Event form validation schema
 */
/**
 * Base event form object schema (without refinements).
 * Used by templateFormSchema which needs .omit() - not available on refined schemas.
 */
export const eventFormBaseSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  description: z
    .string()
    .max(5000, 'Description must be less than 5000 characters')
    .optional(),
  date: z.string().min(1, 'Date is required'),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  isAllDay: z.boolean().default(false),
  timezone: z.string().optional(),
  location: z.string().max(500, 'Location must be less than 500 characters').optional(),
  meetingUrl: z.string().url('Invalid URL format').optional().or(z.literal('')),
  calendarId: z.string().min(1, 'Calendar is required'),
  categoryId: z.string().optional(),
  attendeeIds: z.array(z.string()).optional(),
  recurrence: z.object({
    pattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly']),
    interval: z.number().min(1).max(99).default(1),
    daysOfWeek: z.array(z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])).optional(),
    dayOfMonth: z.number().min(1).max(31).optional(),
    endDate: z.string().optional(),
    maxOccurrences: z.number().min(1).max(999).optional(),
  }).optional(),
  isFocusTime: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  linkedResourceIds: z.array(z.string()).optional(),
});

export const eventFormSchema = eventFormBaseSchema.refine(
  (data) => {
    // Validate end time is after start time for non-all-day events
    if (!data.isAllDay && data.startTime && data.endTime) {
      return data.endTime > data.startTime;
    }
    return true;
  },
  {
    message: 'End time must be after start time',
    path: ['endTime'],
  }
);

/**
 * Event form data type (inferred from schema)
 */
export type EventFormData = z.infer<typeof eventFormSchema>;

/**
 * Default values for event form
 */
export const eventFormDefaults: EventFormData = {
  title: '',
  description: '',
  date: '',
  startTime: '',
  endTime: '',
  isAllDay: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  location: '',
  meetingUrl: '',
  calendarId: '',
  categoryId: '',
  attendeeIds: [],
  recurrence: {
    pattern: 'none',
    interval: 1,
    daysOfWeek: [],
  },
  isFocusTime: false,
  tags: [],
  linkedResourceIds: [],
};

/**
 * Quick capture form schema (simplified event creation)
 */
export const quickCaptureSchema = z.object({
  input: z.string().min(1, 'Please enter event details'),
});

export type QuickCaptureData = z.infer<typeof quickCaptureSchema>;

/**
 * Parsed quick capture result
 */
export interface ParsedQuickCapture {
  title: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  attendees?: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Category form schema
 */
export const categoryFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(50, 'Name must be less than 50 characters'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format'),
  icon: z.string().max(10).optional(),
});

export type CategoryFormData = z.infer<typeof categoryFormSchema>;

/**
 * Template form schema
 */
export const templateFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Template name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z.string().max(500).optional(),
  eventData: eventFormBaseSchema.omit({ date: true, startTime: true, endTime: true }),
});

export type TemplateFormData = z.infer<typeof templateFormSchema>;

/**
 * Recurrence display labels
 */
export const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

/**
 * Day of week display labels
 */
export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, { short: string; full: string }> = {
  monday: { short: 'Mo', full: 'Monday' },
  tuesday: { short: 'Tu', full: 'Tuesday' },
  wednesday: { short: 'We', full: 'Wednesday' },
  thursday: { short: 'Th', full: 'Thursday' },
  friday: { short: 'Fr', full: 'Friday' },
  saturday: { short: 'Sa', full: 'Saturday' },
  sunday: { short: 'Su', full: 'Sunday' },
};
