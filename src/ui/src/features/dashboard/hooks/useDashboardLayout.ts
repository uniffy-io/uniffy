import { useState, useCallback } from 'react';
import { useAppSelector } from '@/app/hooks';

export type WidgetId =
  | 'today-agenda'
  | 'my-tasks'
  | 'recent-activity'
  | 'quick-actions'
  | 'team-presence'
  | 'notifications'
  | 'recent-notes'
  | 'recent-files'
  | 'bookmarks'
  | 'analytics'
  | 'agents';

export type WidgetSize = 'compact' | 'expanded';

export interface WidgetPreference {
  id: WidgetId;
  visible: boolean;
  size: WidgetSize;
}

const DEFAULT_LAYOUT: WidgetPreference[] = [
  { id: 'today-agenda', visible: true, size: 'expanded' },
  { id: 'my-tasks', visible: true, size: 'expanded' },
  { id: 'recent-activity', visible: true, size: 'expanded' },
  { id: 'quick-actions', visible: true, size: 'expanded' },
  { id: 'team-presence', visible: true, size: 'compact' },
  { id: 'notifications', visible: true, size: 'compact' },
  { id: 'recent-notes', visible: true, size: 'expanded' },
  { id: 'recent-files', visible: true, size: 'expanded' },
  { id: 'bookmarks', visible: true, size: 'expanded' },
  { id: 'analytics', visible: true, size: 'expanded' },
  { id: 'agents', visible: true, size: 'expanded' },
];

const STORAGE_KEY_PREFIX = 'uniffy_dashboard_layout_';

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function loadPreferences(userId: string): WidgetPreference[] | null {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePreferences(userId: string, prefs: WidgetPreference[]): void {
  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(prefs));
  } catch {
    // localStorage full or unavailable
  }
}

export function useDashboardLayout() {
  const userId = useAppSelector((state) => state.auth.user?.id ?? 'anonymous');

  const [widgets, setWidgets] = useState<WidgetPreference[]>(() => {
    return loadPreferences(userId) ?? [...DEFAULT_LAYOUT];
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState<WidgetPreference[]>([]);

  const startEditing = useCallback(() => {
    setEditBuffer([...widgets]);
    setIsEditing(true);
  }, [widgets]);

  const cancelEditing = useCallback(() => {
    setEditBuffer([]);
    setIsEditing(false);
  }, []);

  const saveEditing = useCallback(() => {
    setWidgets(editBuffer);
    savePreferences(userId, editBuffer);
    setIsEditing(false);
    setEditBuffer([]);
  }, [editBuffer, userId]);

  const toggleVisibility = useCallback(
    (id: WidgetId) => {
      setEditBuffer((prev) =>
        prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w)),
      );
    },
    [],
  );

  const toggleSize = useCallback(
    (id: WidgetId) => {
      setEditBuffer((prev) =>
        prev.map((w) =>
          w.id === id
            ? { ...w, size: w.size === 'compact' ? 'expanded' : 'compact' }
            : w,
        ),
      );
    },
    [],
  );

  const moveWidget = useCallback(
    (fromIndex: number, toIndex: number) => {
      setEditBuffer((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [],
  );

  const resetToDefault = useCallback(() => {
    const defaults = [...DEFAULT_LAYOUT];
    setWidgets(defaults);
    savePreferences(userId, defaults);
    setEditBuffer([]);
    setIsEditing(false);
  }, [userId]);

  const isWidgetVisible = useCallback(
    (id: WidgetId): boolean => {
      const pref = widgets.find((w) => w.id === id);
      return pref?.visible ?? true;
    },
    [widgets],
  );

  const getWidgetSize = useCallback(
    (id: WidgetId): WidgetSize => {
      const pref = widgets.find((w) => w.id === id);
      return pref?.size ?? 'expanded';
    },
    [widgets],
  );

  return {
    widgets: isEditing ? editBuffer : widgets,
    isEditing,
    startEditing,
    cancelEditing,
    saveEditing,
    toggleVisibility,
    toggleSize,
    moveWidget,
    resetToDefault,
    isWidgetVisible,
    getWidgetSize,
  };
}
