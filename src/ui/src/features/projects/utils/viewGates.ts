import { ViewVisibility } from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewConfig } from "@/features/projects/types/views";

export interface ViewGateContext {
  /** Project role allows editing (EDITOR and up). */
  canEdit: boolean;
  /** Project role allows managing (ADMIN and up). */
  canManage: boolean;
  currentUserId: string | null;
  isDefault: boolean;
}

export interface ViewGates {
  /** Save, rename and delete. */
  canEdit: boolean;
  canReorder: boolean;
  canSetDefault: boolean;
  canMakeShared: boolean;
  canMakePersonal: boolean;
}

/**
 * Mirrors the backend view rules so menus only offer what will work: personal views belong to
 * their owner, shared views to the project's editors, order and default to its admins. The
 * backend stays the gate.
 */
export function viewGates(view: ViewConfig, ctx: ViewGateContext): ViewGates {
  const isOwner = ctx.currentUserId !== null && view.ownerId === ctx.currentUserId;
  if (view.visibility !== ViewVisibility.SHARED) {
    return {
      canEdit: isOwner,
      canReorder: isOwner,
      canSetDefault: false,
      canMakeShared: isOwner && ctx.canEdit,
      canMakePersonal: false,
    };
  }
  return {
    canEdit: ctx.canEdit,
    canReorder: ctx.canManage,
    canSetDefault: ctx.canManage && !ctx.isDefault,
    canMakeShared: false,
    canMakePersonal: isOwner && ctx.canEdit && !ctx.isDefault,
  };
}
