// Re-exported so callers can import UrnType from either '@/shared/utils/urn' or '@/shared/utils/urnTypes'.
export { UrnType } from "@/shared/utils/urnTypes";

import { UrnType } from "@/shared/utils/urnTypes";

/** Channel-wide broadcast mentions (@channel/@here) ride this non-content scheme. */
export const BROADCAST_URN_PREFIX = "urn:uniffy:broadcast:";

export interface ParsedUrn {
  urn: string;
  type: UrnType;
  id: string;
  isValid: boolean;
}

/** Accepts both `urn:uniffy:{type}:{id}` and `urn:uniffy:content:{TYPE}:{id}` forms. */
export function parseUrn(urn: string): ParsedUrn {
  if (!urn || typeof urn !== "string") {
    return {
      urn: urn || "",
      type: UrnType.UNKNOWN,
      id: "",
      isValid: false,
    };
  }

  const parts = urn.split(":");

  if (parts.length < 4 || parts[0] !== "urn" || parts[1] !== "uniffy") {
    return {
      urn,
      type: UrnType.UNKNOWN,
      id: "",
      isValid: false,
    };
  }

  let typeStr: string;
  let id: string;

  if (parts[2] === "content" && parts.length === 5) {
    typeStr = parts[3].toLowerCase();
    id = parts[4];
  } else if (parts.length === 4) {
    typeStr = parts[2];
    id = parts[3];
  } else {
    return {
      urn,
      type: UrnType.UNKNOWN,
      id: "",
      isValid: false,
    };
  }

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

export function buildUrn(type: UrnType | string, id: string): string {
  return `urn:uniffy:${type}:${id}`;
}

import type { Icon } from "@phosphor-icons/react";
import {
  getContentTypeConfig,
  getContentTypeIcon,
  getContentTypeLabel,
  getContentTypeRoute,
} from "@/config/theme/contentTypes";

export function urnToPath(urn: string): string {
  const parsed = parseUrn(urn);

  if (!parsed.isValid) {
    return "#";
  }

  // Tasks need project context.
  if (parsed.type === UrnType.TASK) {
    return `/projects/task/${parsed.id}`;
  }

  // A calendar is a view of the calendar page, not a page of its own.
  if (parsed.type === UrnType.CALENDAR) {
    return `/calendar?calendar=${parsed.id}`;
  }

  // Chat messages need a channel id (not encoded in the URN) to resolve `/chat/{channel}#{message}`;
  // callers must use the URL from mention state, never this fallback.
  if (parsed.type === UrnType.CHAT_MESSAGE) {
    return "#";
  }

  const route = getContentTypeRoute(parsed.type);
  return route ? `/${route}/${parsed.id}` : "#";
}

export function getUrnIcon(urn: string): Icon {
  const parsed = parseUrn(urn);
  return getContentTypeIcon(parsed.type);
}

export function getUrnTypeLabel(urn: string): string {
  const parsed = parseUrn(urn);
  return getContentTypeLabel(parsed.type);
}

export function getUrnContentTypeConfig(urn: string) {
  const parsed = parseUrn(urn);
  return getContentTypeConfig(parsed.type);
}

export function isValidUrn(urn: string): boolean {
  return parseUrn(urn).isValid;
}
