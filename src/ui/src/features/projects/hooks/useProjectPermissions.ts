import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentProject, selectTasksMap } from '@/features/projects/store/projectsSlice';
import { roleCanView, roleCanEdit, roleCanManage, roleCanDelete, roleCanTransfer } from '@/shared/utils/contentRoles';

export function useProjectPermission(): {
  canView: boolean;
  canEdit: boolean;
  canManage: boolean;
  canDelete: boolean;
  canTransferOwnership: boolean;
} {
  const project = useAppSelector(selectCurrentProject);

  return useMemo(() => {
    const role = project?.userRole ?? null;
    return {
      canView: roleCanView(role),
      canEdit: roleCanEdit(role),
      canManage: roleCanManage(role),
      canDelete: roleCanDelete(role),
      canTransferOwnership: roleCanTransfer(role),
    };
  }, [project?.userRole]);
}

export function useTaskPermission(taskId: string): { canEdit: boolean } {
  const tasksMap = useAppSelector(selectTasksMap);
  const project = useAppSelector(selectCurrentProject);

  return useMemo(() => {
    const task = tasksMap[taskId];
    const role = (task?.userRole && task.userRole > 0) ? task.userRole : project?.userRole ?? null;
    return {
      canEdit: roleCanEdit(role),
    };
  }, [tasksMap, taskId, project?.userRole]);
}
