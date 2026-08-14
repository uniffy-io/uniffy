import type { CalendarEvent } from "@/features/calendar/types";
import { roleCanEdit, roleCanDelete, roleCanManage } from "@/shared/utils/contentRoles";

export function useEventPermission(event: CalendarEvent | null): {
  canEdit: boolean;
  canDelete: boolean;
  canManage: boolean;
} {
  const role = event?.userRole ?? null;
  return {
    canEdit: roleCanEdit(role),
    canDelete: roleCanDelete(role),
    canManage: roleCanManage(role),
  };
}
