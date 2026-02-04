/**
 * URN Utilities
 *
 * Utilities for parsing and working with URNs in the Uniffy system.
 *
 * Supported URN formats:
 * - urn:uniffy:{type}:{id} (legacy format)
 * - urn:uniffy:content:{TYPE}:{id} (new format with content namespace)
 *
 * Examples:
 * - urn:uniffy:note:123e4567-e89b-12d3-a456-426614174000
 * - urn:uniffy:content:NOTE:123e4567-e89b-12d3-a456-426614174000
 * - urn:uniffy:content:USER:456e7890-e89b-12d3-a456-426614174001
 */

// Re-export UrnType from dedicated file to avoid circular dependencies
// Consumers can import from either '@/utils/urn' or '@/utils/urnTypes'
export { UrnType } from '@/shared/utils/urnTypes';

// Local import for use in this file
import { UrnType } from '@/shared/utils/urnTypes';

export interface ParsedUrn {
  /** Full URN string */
  urn: string;
  /** The type of the resource (note, file, etc.) */
  type: UrnType;
  /** The resource ID */
  id: string;
  /** Whether the URN is valid */
  isValid: boolean;
}

/**
 * Parse a URN string into its components
 * Supports both formats:
 * - urn:uniffy:{type}:{id}
 * - urn:uniffy:content:{TYPE}:{id}
 */
export function parseUrn(urn: string): ParsedUrn {
  // Basic validation
  if (!urn || typeof urn !== 'string') {
    return {
      urn: urn || '',
      type: UrnType.UNKNOWN,
      id: '',
      isValid: false,
    };
  }

  const parts = urn.split(':');

  // Must start with urn:uniffy
  if (parts.length < 4 || parts[0] !== 'urn' || parts[1] !== 'uniffy') {
    return {
      urn,
      type: UrnType.UNKNOWN,
      id: '',
      isValid: false,
    };
  }

  let typeStr: string;
  let id: string;

  // Check for new format: urn:uniffy:content:{TYPE}:{id}
  if (parts[2] === 'content' && parts.length === 5) {
    typeStr = parts[3].toLowerCase(); // TYPE is uppercase in new format
    id = parts[4];
  }
  // Legacy format: urn:uniffy:{type}:{id}
  else if (parts.length === 4) {
    typeStr = parts[2];
    id = parts[3];
  }
  // Invalid format
  else {
    return {
      urn,
      type: UrnType.UNKNOWN,
      id: '',
      isValid: false,
    };
  }

  // Map type string to enum
  const type = Object.values(UrnType).includes(typeStr as UrnType)
    ? (typeStr as UrnType)
    : UrnType.UNKNOWN;

  return {
    urn,
    type,
    id,
    isValid: type !== UrnType.UNKNOWN && !!id,
  };
}

/**
 * Build a URN from type and id
 */
export function buildUrn(type: UrnType | string, id: string): string {
  return `urn:uniffy:${type}:${id}`;
}

// Import centralized content type config
// Note: ES modules handle circular imports correctly when the imported values
// are accessed at function call time rather than module initialization time
import type { Icon } from '@phosphor-icons/react';
import {
  getContentTypeConfig,
  getContentTypeIcon,
  getContentTypeLabel,
  getContentTypeRoute,
} from '@/config/theme/contentTypes';

/**
 * Extract the URL path from a URN
 * Example: urn:uniffy:note:123 -> /notes/123
 *
 * Uses centralized route config from @/theme/contentTypes
 */
export function urnToPath(urn: string): string {
  const parsed = parseUrn(urn);

  if (!parsed.isValid) {
    return '#';
  }

  const route = getContentTypeRoute(parsed.type);
  return route ? `/${route}/${parsed.id}` : '#';
}

/**
 * Get display icon component for URN type
 *
 * Returns a Phosphor icon component from centralized config.
 * Use this when you need the icon component directly.
 */
export function getUrnIcon(urn: string): Icon {
  const parsed = parseUrn(urn);
  return getContentTypeIcon(parsed.type);
}

/**
 * Get human-readable type label for URN
 *
 * Uses centralized label config from @/theme/contentTypes
 */
export function getUrnTypeLabel(urn: string): string {
  const parsed = parseUrn(urn);
  return getContentTypeLabel(parsed.type);
}

/**
 * Get full content type configuration for a URN
 *
 * Returns the complete config including icon, labels, route, and theme.
 */
export function getUrnContentTypeConfig(urn: string) {
  const parsed = parseUrn(urn);
  return getContentTypeConfig(parsed.type);
}

/**
 * Validate if a string is a valid Uniffy URN
 */
export function isValidUrn(urn: string): boolean {
  return parseUrn(urn).isValid;
}
