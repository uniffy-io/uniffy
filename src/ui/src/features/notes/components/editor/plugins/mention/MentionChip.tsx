/**
 * Mention Chip Component
 *
 * Renders a rich inline preview for URN-based mentions.
 * Features glassmorphism, gradients, and micro-animations.
 *
 * Components:
 * - MentionChip: Full-featured chip with hover preview (requires Redux context)
 * - MentionChipBasic: Simplified chip without hover preview (no Redux dependency)
 * - MentionChipCompact: Compact variant with hover preview (requires Redux context)
 *
 * The ProseMirror NodeView wraps MentionChip with Redux Provider to enable hover previews.
 */

import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { parseUrn, getUrnTypeLabel, UrnType } from '@/utils/urn';
import {
  DocumentTextIcon,
  FolderIcon,
  ChatBubbleLeftRightIcon,
  UserIcon,
  BookOpenIcon,
  CalendarIcon,
  KeyIcon,
  CubeIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { MentionPreview } from './MentionPreview';
import { useUrnPreview } from './useUrnPreview';

interface MentionChipProps {
  urn: string;
  label: string;
  selected?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
}

interface MentionChipBasicProps {
  urn: string;
  label: string;
  selected?: boolean;
}

/**
 * Type-specific styling configuration with gradients
 */
interface TypeStyle {
  icon: typeof DocumentTextIcon;
  gradient: string;
  glowColor: string;
  iconBg: string;
  iconColor: string;
  borderColor: string;
}

/**
 * Get complete styling for URN type
 */
function getTypeStyle(type: UrnType): TypeStyle {
  const styleMap: Record<UrnType, TypeStyle> = {
    [UrnType.NOTE]: {
      icon: DocumentTextIcon,
      gradient: 'from-primary/10 via-primary/5 to-transparent',
      glowColor: 'group-hover:shadow-primary/25',
      iconBg: 'bg-gradient-to-br from-primary to-primary/80',
      iconColor: 'text-primary-foreground',
      borderColor: 'border-primary/30 group-hover:border-primary/50',
    },
    [UrnType.FILE]: {
      icon: FolderIcon,
      gradient: 'from-blue-500/10 via-blue-500/5 to-transparent',
      glowColor: 'group-hover:shadow-blue-500/25',
      iconBg: 'bg-gradient-to-br from-blue-500 to-blue-600',
      iconColor: 'text-white',
      borderColor: 'border-blue-500/30 group-hover:border-blue-500/50',
    },
    [UrnType.CHAT]: {
      icon: ChatBubbleLeftRightIcon,
      gradient: 'from-violet-500/10 via-violet-500/5 to-transparent',
      glowColor: 'group-hover:shadow-violet-500/25',
      iconBg: 'bg-gradient-to-br from-violet-500 to-violet-600',
      iconColor: 'text-white',
      borderColor: 'border-violet-500/30 group-hover:border-violet-500/50',
    },
    [UrnType.USER]: {
      icon: UserIcon,
      gradient: 'from-emerald-500/10 via-emerald-500/5 to-transparent',
      glowColor: 'group-hover:shadow-emerald-500/25',
      iconBg: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      iconColor: 'text-white',
      borderColor: 'border-emerald-500/30 group-hover:border-emerald-500/50',
    },
    [UrnType.BOOK]: {
      icon: BookOpenIcon,
      gradient: 'from-amber-500/10 via-amber-500/5 to-transparent',
      glowColor: 'group-hover:shadow-amber-500/25',
      iconBg: 'bg-gradient-to-br from-amber-500 to-amber-600',
      iconColor: 'text-white',
      borderColor: 'border-amber-500/30 group-hover:border-amber-500/50',
    },
    [UrnType.CALENDAR_EVENT]: {
      icon: CalendarIcon,
      gradient: 'from-rose-500/10 via-rose-500/5 to-transparent',
      glowColor: 'group-hover:shadow-rose-500/25',
      iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600',
      iconColor: 'text-white',
      borderColor: 'border-rose-500/30 group-hover:border-rose-500/50',
    },
    [UrnType.PASSWORD]: {
      icon: KeyIcon,
      gradient: 'from-red-500/10 via-red-500/5 to-transparent',
      glowColor: 'group-hover:shadow-red-500/25',
      iconBg: 'bg-gradient-to-br from-red-500 to-red-600',
      iconColor: 'text-white',
      borderColor: 'border-red-500/30 group-hover:border-red-500/50',
    },
    [UrnType.SPACE]: {
      icon: CubeIcon,
      gradient: 'from-indigo-500/10 via-indigo-500/5 to-transparent',
      glowColor: 'group-hover:shadow-indigo-500/25',
      iconBg: 'bg-gradient-to-br from-indigo-500 to-indigo-600',
      iconColor: 'text-white',
      borderColor: 'border-indigo-500/30 group-hover:border-indigo-500/50',
    },
    [UrnType.UNKNOWN]: {
      icon: LinkIcon,
      gradient: 'from-gray-500/10 via-gray-500/5 to-transparent',
      glowColor: 'group-hover:shadow-gray-500/20',
      iconBg: 'bg-gradient-to-br from-gray-400 to-gray-500',
      iconColor: 'text-white',
      borderColor: 'border-border group-hover:border-border',
    },
  };

  return styleMap[type];
}

// Delay before showing preview (ms)
const HOVER_DELAY = 400;

/**
 * Rich inline mention chip with glassmorphism and gradient effects.
 * Shows a detailed preview popover on hover.
 */
export function MentionChip({ urn, label, selected = false, onClick }: MentionChipProps) {
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const Icon = style.icon;

  // Hover preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  // Preview data fetching
  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = setTimeout(() => {
      if (chipRef.current) {
        const rect = chipRef.current.getBoundingClientRect();
        setPreviewPosition({
          x: rect.left,
          y: rect.bottom,
        });
        fetchPreview(urn);
        setShowPreview(true);
      }
    }, HOVER_DELAY);
  }, [urn, fetchPreview]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setShowPreview(false);
  }, []);

  const handleClosePreview = useCallback(() => {
    setShowPreview(false);
  }, []);

  return (
    <>
      <span
        ref={chipRef}
        className={`
          mention-chip group inline-flex items-center gap-2.5
          px-3 py-1.5 mx-0.5 my-1
          rounded-full
          bg-gradient-to-r ${style.gradient}
          backdrop-blur-sm
          border ${style.borderColor}
          shadow-sm ${style.glowColor}
          cursor-pointer
          transition-all duration-200 ease-out
          hover:shadow-md hover:scale-[1.02]
          active:scale-[0.98]
          ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
        `}
        onClick={(e) => onClick?.(e)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={`Open ${typeLabel}: ${label} (Cmd/Ctrl+Click for new tab)`}
      >
        {/* Icon with gradient background */}
        <span className={`
          flex items-center justify-center
          w-7 h-7 rounded-full
          ${style.iconBg}
          shadow-sm
          transition-transform duration-200
          group-hover:scale-110
        `}>
          <Icon className={`w-4 h-4 ${style.iconColor}`} />
        </span>

        {/* Label */}
        <span className="text-base font-medium text-foreground truncate max-w-[200px] leading-none pr-1">
          {label}
        </span>

        {/* Subtle shimmer effect on hover */}
        <span className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full pointer-events-none"
          style={{ transition: 'transform 0.6s ease-out, opacity 0.3s' }}
        />
      </span>

      {/* Hover preview popover */}
      {showPreview && createPortal(
        <MentionPreview
          preview={preview}
          isLoading={isLoading}
          error={error}
          position={previewPosition}
          onClose={handleClosePreview}
        />,
        document.body
      )}
    </>
  );
}

/**
 * Basic mention chip for use in ProseMirror NodeView (outside Redux context).
 * Same visual style but without hover preview functionality.
 */
export function MentionChipBasic({ urn, label, selected = false }: MentionChipBasicProps) {
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const Icon = style.icon;

  return (
    <span
      className={`
        mention-chip group inline-flex items-center gap-2.5
        px-3 py-1.5 mx-0.5 my-1
        rounded-full
        bg-gradient-to-r ${style.gradient}
        backdrop-blur-sm
        border ${style.borderColor}
        shadow-sm ${style.glowColor}
        cursor-pointer
        transition-all duration-200 ease-out
        hover:shadow-md hover:scale-[1.02]
        active:scale-[0.98]
        ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}
      `}
      title={`Open ${typeLabel}: ${label} (Cmd/Ctrl+Click for new tab)`}
    >
      {/* Icon with gradient background */}
      <span className={`
        flex items-center justify-center
        w-7 h-7 rounded-full
        ${style.iconBg}
        shadow-sm
        transition-transform duration-200
        group-hover:scale-110
      `}>
        <Icon className={`w-4 h-4 ${style.iconColor}`} />
      </span>

      {/* Label */}
      <span className="text-base font-medium text-foreground truncate max-w-[200px] leading-none pr-1">
        {label}
      </span>
    </span>
  );
}

/**
 * Compact inline variant - minimal footprint for dense text.
 */
export function MentionChipCompact({ urn, label, selected = false, onClick }: MentionChipProps) {
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const Icon = style.icon;

  // Hover preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = setTimeout(() => {
      if (chipRef.current) {
        const rect = chipRef.current.getBoundingClientRect();
        setPreviewPosition({
          x: rect.left,
          y: rect.bottom,
        });
        fetchPreview(urn);
        setShowPreview(true);
      }
    }, HOVER_DELAY);
  }, [urn, fetchPreview]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setShowPreview(false);
  }, []);

  return (
    <>
      <span
        ref={chipRef}
        className={`
          mention-chip-compact group inline-flex items-center gap-1
          px-1.5 py-0.5 mx-0.5
          rounded-md
          bg-gradient-to-r ${style.gradient}
          border ${style.borderColor}
          cursor-pointer
          transition-all duration-150
          hover:shadow-sm
          ${selected ? 'ring-1 ring-primary' : ''}
        `}
        onClick={(e) => onClick?.(e)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={`Open ${typeLabel}: ${label}`}
      >
        <span className={`
          flex items-center justify-center
          w-4 h-4 rounded
          ${style.iconBg}
        `}>
          <Icon className={`w-2.5 h-2.5 ${style.iconColor}`} />
        </span>
        <span className="text-xs font-medium text-foreground truncate max-w-[120px]">
          {label}
        </span>
      </span>

      {showPreview && createPortal(
        <MentionPreview
          preview={preview}
          isLoading={isLoading}
          error={error}
          position={previewPosition}
          onClose={() => setShowPreview(false)}
        />,
        document.body
      )}
    </>
  );
}
