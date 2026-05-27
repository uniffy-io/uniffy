import type { CategoryColorOption, Category } from '@/features/calendar/types';

export const CATEGORY_COLORS: CategoryColorOption[] = [
  {
    name: 'Blue',
    value: '#3B82F6',
    light: 'rgba(59, 130, 246, 0.1)',
  },
  {
    name: 'Purple',
    value: '#8B5CF6',
    light: 'rgba(139, 92, 246, 0.1)',
  },
  {
    name: 'Green',
    value: '#10B981',
    light: 'rgba(16, 185, 129, 0.1)',
  },
  {
    name: 'Red',
    value: '#EF4444',
    light: 'rgba(239, 68, 68, 0.1)',
  },
  {
    name: 'Orange',
    value: '#F59E0B',
    light: 'rgba(245, 158, 11, 0.1)',
  },
  {
    name: 'Pink',
    value: '#EC4899',
    light: 'rgba(236, 72, 153, 0.1)',
  },
  {
    name: 'Teal',
    value: '#14B8A6',
    light: 'rgba(20, 184, 166, 0.1)',
  },
  {
    name: 'Indigo',
    value: '#6366F1',
    light: 'rgba(99, 102, 241, 0.1)',
  },
  {
    name: 'Gray',
    value: '#64748B',
    light: 'rgba(100, 116, 139, 0.1)',
  },
];

export const DEFAULT_CATEGORIES: Omit<Category, 'organizationId' | 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'meetings',
    name: 'Meetings',
    color: '#3B82F6',
    icon: '📅',
    isDefault: true,
    sortOrder: 0,
  },
  {
    id: 'deep_work',
    name: 'Deep Work',
    color: '#8B5CF6',
    icon: '🎯',
    isDefault: true,
    sortOrder: 1,
  },
  {
    id: 'personal',
    name: 'Personal',
    color: '#10B981',
    icon: '🏠',
    isDefault: true,
    sortOrder: 2,
  },
  {
    id: 'deadline',
    name: 'Deadline',
    color: '#EF4444',
    icon: '⏰',
    isDefault: true,
    sortOrder: 3,
  },
];

export function getCategoryColor(categoryId: string): string {
  const category = DEFAULT_CATEGORIES.find((c) => c.id === categoryId);
  return category?.color ?? CATEGORY_COLORS[0].value;
}

export function getCategoryBackgroundColor(categoryId: string, isDark = false): string {
  const category = DEFAULT_CATEGORIES.find((c) => c.id === categoryId);
  const color = category?.color ?? CATEGORY_COLORS[0].value;

  const colorOption = CATEGORY_COLORS.find((c) => c.value === color);

  if (colorOption) {
    if (isDark) {
      return colorOption.light.replace('0.1', '0.2');
    }
    return colorOption.light;
  }

  const opacity = isDark ? 0.2 : 0.1;
  return hexToRgba(color, opacity);
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const CALENDAR_COLORS = {
  personal: '#3B82F6',
  work: '#8B5CF6',
  team: '#10B981',
  shared: '#F59E0B',
};

export const FOCUS_TIME_COLOR = '#8B5CF6';

export const CURRENT_TIME_COLOR = '#EF4444';
