import {
  ProjectorScreen,
  Chalkboard,
  VideoCamera,
  SpeakerHigh,
  Monitor,
  Person,
  ThermometerCold,
  Sun,
  WheelchairMotion,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

export const AMENITY_ICONS: Record<string, Icon> = {
  'Projector': ProjectorScreen,
  'Whiteboard': Chalkboard,
  'Video Conferencing': VideoCamera,
  'Speaker Phone': SpeakerHigh,
  'TV Screen': Monitor,
  'Standing Desks': Person,
  'Air Conditioning': ThermometerCold,
  'Natural Light': Sun,
  'Wheelchair Accessible': WheelchairMotion,
};

/**
 * Status colors for room operational status.
 * Uses Tailwind status colors (allowed exception per frontend.md).
 */
export const ROOM_STATUS_STYLES: Record<string, { dot: string; bg: string }> = {
  active: {
    dot: 'bg-green-500',
    bg: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  maintenance: {
    dot: 'bg-yellow-500',
    bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  },
  retired: {
    dot: 'bg-muted-foreground/40',
    bg: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  },
};

export const ROOMS_LAYOUT = {
  SIDEBAR_WIDTH: 260,
  DETAIL_PANEL_WIDTH: 340,
} as const;

export const DEFAULT_PAGE_SIZE = 50;
