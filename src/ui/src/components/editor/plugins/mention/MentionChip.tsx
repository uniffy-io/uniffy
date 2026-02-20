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
import { parseUrn, getUrnTypeLabel, UrnType } from '@/shared/utils/urn';
import { buildFileUrl, buildMediaStreamUrl } from '@/shared/utils/fileUrls';
import { MentionPreview } from '@/components/editor/plugins/mention/MentionPreview';
import { useUrnPreview } from '@/components/editor/plugins/mention/useUrnPreview';
import { getContentTypeConfig } from '@/config/theme/contentTypes';
import { useAppSelector } from '@/app/hooks';
import type { Icon } from '@phosphor-icons/react';

/**
 * Small avatar image for user mention chips.
 * Falls back to the type icon on load error.
 */
function UserAvatar({ userId, className, fallback }: { userId: string; className: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={`/api/avatars/${userId}/sm`}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

interface MentionChipProps {
  urn: string;
  label: string;
  selected?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
  onReplaceWithMedia?: (mediaType: 'image' | 'video' | 'audio', url: string, title: string) => void;
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
  icon: Icon;
  gradient: string;
  glowColor: string;
  iconBg: string;
  iconColor: string;
  borderColor: string;
}

/**
 * Get complete styling for URN type using centralized config
 */
function getTypeStyle(type: UrnType): TypeStyle {
  const config = getContentTypeConfig(type);
  const theme = config.theme;

  // Convert theme to chip-specific styling
  return {
    icon: config.icon,
    gradient: theme.gradient,
    glowColor: `group-hover:${theme.shadow}`,
    iconBg: theme.iconBg,
    iconColor: 'text-white',
    borderColor: `${theme.border} group-hover:${theme.border}`,
  };
}

// Delay before showing preview (ms)
const HOVER_DELAY = 400;
// Delay before closing preview when mouse leaves chip/popover (ms)
const CLOSE_DELAY = 400;

/**
 * Rich inline mention chip with glassmorphism and gradient effects.
 * Shows a detailed preview popover on hover.
 */
export function MentionChip({ urn, label, selected = false, onClick, onReplaceWithMedia }: MentionChipProps) {
  const parsed = parseUrn(urn);
  const style = getTypeStyle(parsed.type);
  const typeLabel = getUrnTypeLabel(urn);
  const Icon = style.icon;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  // Hover preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewPosition, setPreviewPosition] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  // Preview data fetching
  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, CLOSE_DELAY);
  }, [cancelClose]);

  const handleMouseEnter = useCallback(() => {
    cancelClose();
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
  }, [urn, fetchPreview, cancelClose]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  const handleClosePreview = useCallback(() => {
    cancelClose();
    setShowPreview(false);
  }, [cancelClose]);

  // Handle embed action: convert mention chip to inline media
  const handleEmbed = useCallback(() => {
    if (!preview || !onReplaceWithMedia || !organizationId) return;

    const mimeType = preview.metadata?.mime_type;
    if (!mimeType) return;

    if (!parsed.isValid || !parsed.id) return;

    let mediaType: 'image' | 'video' | 'audio';
    let url: string;

    if (mimeType.startsWith('image/')) {
      mediaType = 'image';
      url = buildFileUrl(organizationId, parsed.id);
    } else if (mimeType.startsWith('video/')) {
      mediaType = 'video';
      url = buildMediaStreamUrl(organizationId, parsed.id);
    } else if (mimeType.startsWith('audio/')) {
      mediaType = 'audio';
      url = buildMediaStreamUrl(organizationId, parsed.id);
    } else {
      return;
    }

    setShowPreview(false);
    onReplaceWithMedia(mediaType, url, label);
  }, [preview, onReplaceWithMedia, organizationId, parsed.isValid, parsed.id, label]);

  return (
    <>
      <span
        ref={chipRef}
        className={`
          mention-chip group inline-flex items-center align-middle gap-2.5
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
        {/* Icon/avatar with gradient background */}
        {parsed.type === UrnType.USER && parsed.id ? (
          <span className="flex items-center justify-center shrink-0 w-7 h-7 rounded-full shadow-sm transition-transform duration-200 group-hover:scale-110 overflow-hidden">
            <UserAvatar
              userId={parsed.id}
              className="w-7 h-7 rounded-full object-cover"
              fallback={
                <span className={`flex items-center justify-center w-7 h-7 rounded-full ${style.iconBg}`}>
                  <Icon size={16} weight="duotone" className={style.iconColor} />
                </span>
              }
            />
          </span>
        ) : (
          <span className={`flex items-center justify-center shrink-0 w-7 h-7 rounded-full ${style.iconBg} shadow-sm transition-transform duration-200 group-hover:scale-110`}>
            <Icon size={16} weight="duotone" className={style.iconColor} />
          </span>
        )}

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
          onEmbed={onReplaceWithMedia ? handleEmbed : undefined}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
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
        mention-chip group inline-flex items-center align-middle gap-2.5
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
      {/* Icon/avatar with gradient background */}
      {parsed.type === UrnType.USER && parsed.id ? (
        <span className="flex items-center justify-center shrink-0 w-7 h-7 rounded-full shadow-sm transition-transform duration-200 group-hover:scale-110 overflow-hidden">
          <UserAvatar
            userId={parsed.id}
            className="w-7 h-7 rounded-full object-cover"
            fallback={
              <span className={`flex items-center justify-center w-7 h-7 rounded-full ${style.iconBg}`}>
                <Icon size={16} weight="duotone" className={style.iconColor} />
              </span>
            }
          />
        </span>
      ) : (
        <span className={`flex items-center justify-center shrink-0 w-7 h-7 rounded-full ${style.iconBg} shadow-sm transition-transform duration-200 group-hover:scale-110`}>
          <Icon size={16} weight="duotone" className={style.iconColor} />
        </span>
      )}

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
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipRef = useRef<HTMLSpanElement>(null);

  const { preview, isLoading, error, fetchPreview } = useUrnPreview();

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setShowPreview(false);
    }, CLOSE_DELAY);
  }, [cancelClose]);

  const handleMouseEnter = useCallback(() => {
    cancelClose();
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
  }, [urn, fetchPreview, cancelClose]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  return (
    <>
      <span
        ref={chipRef}
        className={`
          mention-chip-compact group inline-flex items-center align-middle gap-1
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
        {parsed.type === UrnType.USER && parsed.id ? (
          <span className="flex items-center justify-center shrink-0 w-4 h-4 rounded-full overflow-hidden">
            <UserAvatar
              userId={parsed.id}
              className="w-4 h-4 rounded-full object-cover"
              fallback={
                <span className={`flex items-center justify-center w-4 h-4 rounded ${style.iconBg}`}>
                  <Icon size={10} weight="duotone" className={style.iconColor} />
                </span>
              }
            />
          </span>
        ) : (
          <span className={`flex items-center justify-center shrink-0 w-4 h-4 rounded ${style.iconBg}`}>
            <Icon size={10} weight="duotone" className={style.iconColor} />
          </span>
        )}
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
          onClose={() => { cancelClose(); setShowPreview(false); }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />,
        document.body
      )}
    </>
  );
}
