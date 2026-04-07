import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentProject, selectTasksMap } from '@/features/projects/store/projectsSlice';
import { PermissionLevel } from '@uniffy/proto/common/v1/common_pb';

/**
 * Resolve a permission level value, treating 0 (UNSPECIFIED) as unknown.
 *
 * When the backend doesn't populate `user_permission_level` (e.g. list
 * endpoints), the proto default is 0.  We treat that as "not determined"
 * and fall back to EDIT so the UI stays interactive.  The backend still
 * enforces permissions on every write operation.
 */
function resolveLevel(level: number | undefined): number {
  return level && level > 0 ? level : PermissionLevel.EDIT;
}

/**
 * Returns the current user's permission for the active project.
 *
 * Permission levels from proto:
 *   0 = UNSPECIFIED, 1 = VIEW, 2 = EDIT, 3 = ADMIN
 *
 * canAccessSettings is true for project owner, org admin/owner,
 * projects domain admin, or system admin.
 */
export function useProjectPermission(): {
  canEdit: boolean;
  canAdmin: boolean;
  canAccessSettings: boolean;
} {
  const project = useAppSelector(selectCurrentProject);
  const isSystemAdmin = useAppSelector((s) => s.auth.user?.isSystemAdmin ?? false);

  return useMemo(() => {
    const level = resolveLevel(project?.userPermissionLevel);
    const canAdmin = level >= PermissionLevel.ADMIN;
    return {
      canEdit: level >= PermissionLevel.EDIT,
      canAdmin,
      canAccessSettings: canAdmin || isSystemAdmin,
    };
  }, [project?.userPermissionLevel, isSystemAdmin]);
}

/**
 * Returns the current user's permission for a specific task.
 * Falls back to the project-level permission if the task has no explicit level.
 */
export function useTaskPermission(taskId: string): { canEdit: boolean } {
  const tasksMap = useAppSelector(selectTasksMap);
  const project = useAppSelector(selectCurrentProject);

  return useMemo(() => {
    const task = tasksMap[taskId];
    const taskLevel = task?.userPermissionLevel;
    const projectLevel = project?.userPermissionLevel;
    // Prefer task-level, then project-level, then default to EDIT
    const level = resolveLevel(taskLevel && taskLevel > 0 ? taskLevel : projectLevel);
    return {
      canEdit: level >= PermissionLevel.EDIT,
    };
  }, [tasksMap, taskId, project?.userPermissionLevel]);
}
