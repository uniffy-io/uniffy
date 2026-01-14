/**
 * Mention Chip Component
 *
 * Renders a clickable chip for URN-based mentions.
 * Different URN types will be visualized differently (extensible).
 */

import { parseUrn, urnToPath, getUrnTypeLabel, UrnType } from '@/utils/urn';
import {
  DocumentTextIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  BookOpenIcon,
  CalendarIcon,
  KeyIcon,
  CubeIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';

interface MentionChipProps {
  urn: string;
  label: string;
  selected?: boolean;
  onClick?: () => void;
}

/**
 * Get icon component for URN type
 */
function getIconForType(type: UrnType) {
  const iconMap: Record<UrnType, typeof DocumentTextIcon> = {
    [UrnType.NOTE]: DocumentTextIcon,
    [UrnType.FILE]: FolderIcon,
    [UrnType.CHAT]: ChatBubbleLeftRightIcon,
    [UrnType.USER]: UserIcon,
    [UrnType.BOOK]: BookOpenIcon,
    [UrnType.CALENDAR_EVENT]: CalendarIcon,
    [UrnType.PASSWORD]: KeyIcon,
    [UrnType.SPACE]: CubeIcon,
    [UrnType.UNKNOWN]: QuestionMarkCircleIcon,
  };

  return iconMap[type];
}

/**
 * Get color classes for URN type
 * This will be the hook for future custom visualizations per type
 */
function getColorForType(type: UrnType): string {
  // For now, all use primary color
  // TODO: Customize colors per type in future
  const colorMap: Record<UrnType, string> = {
    [UrnType.NOTE]: 'bg-primary/10 text-primary hover:bg-primary/20 border-primary/20',
    [UrnType.FILE]: 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400',
    [UrnType.CHAT]: 'bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400',
    [UrnType.USER]: 'bg-green-100 text-green-800 hover:bg-green-200 border-green-200 dark:bg-green-900/30 dark:text-green-400',
    [UrnType.BOOK]: 'bg-orange-100 text-orange-800 hover:bg-orange-200 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400',
    [UrnType.CALENDAR_EVENT]: 'bg-pink-100 text-pink-800 hover:bg-pink-200 border-pink-200 dark:bg-pink-900/30 dark:text-pink-400',
    [UrnType.PASSWORD]: 'bg-red-100 text-red-800 hover:bg-red-200 border-red-200 dark:bg-red-900/30 dark:text-red-400',
    [UrnType.SPACE]: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400',
    [UrnType.UNKNOWN]: 'bg-muted text-muted-foreground hover:bg-muted/80 border-border',
  };

  return colorMap[type];
}

/**
 * Base mention chip - can be extended for custom rendering per type
 */
export function MentionChip({ urn, label, selected = false, onClick }: MentionChipProps) {
  const parsed = parseUrn(urn);
  const Icon = getIconForType(parsed.type);
  const colorClasses = getColorForType(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);

  // TODO: In the future, we can return different components based on type
  // For example:
  // if (parsed.type === UrnType.USER) return <UserMentionChip ... />;
  // if (parsed.type === UrnType.FILE) return <FileMentionChip ... />;

  return (
    <span
      className={`
        mention-chip inline-flex items-center gap-1 px-2 py-0.5 mx-0.5
        rounded-md text-sm font-medium border
        cursor-pointer transition-colors
        ${colorClasses}
        ${selected ? 'ring-2 ring-primary' : ''}
      `}
      onClick={onClick}
      title={`${typeLabel}: ${label} (${urn})`}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="truncate max-w-xs">@{label}</span>
    </span>
  );
}

/**
 * Hook for future custom mention chip types
 *
 * Example usage when we want type-specific rendering:
 *
 * export function UserMentionChip({ urn, label }: MentionChipProps) {
 *   // Fetch user avatar, status, etc.
 *   return (
 *     <span className="...">
 *       <Avatar src={userAvatar} />
 *       <span>@{label}</span>
 *       <StatusBadge status={userStatus} />
 *     </span>
 *   );
 * }
 *
 * export function FileMentionChip({ urn, label }: MentionChipProps) {
 *   // Show file icon based on extension, file size, etc.
 *   return (
 *     <span className="...">
 *       <FileIcon ext={fileExt} />
 *       <span>@{label}</span>
 *       <span className="text-xs">{fileSize}</span>
 *     </span>
 *   );
 * }
 */
