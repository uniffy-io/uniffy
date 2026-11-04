import { createContext, useCallback, useContext } from "react";
import { useAppDispatch } from "@/app/hooks";
import { selectTask } from "@/features/projects/store/projectsUiSlice";

/**
 * How a task detail host opens another task (a subtask, the parent). Inside a project the
 * selection drives the panel; the full page supplies its own navigation.
 */
export const OpenTaskContext = createContext<((taskId: string) => void) | null>(null);

export function useOpenTask(): (taskId: string) => void {
  const dispatch = useAppDispatch();
  const host = useContext(OpenTaskContext);
  const select = useCallback((taskId: string) => dispatch(selectTask(taskId)), [dispatch]);
  return host ?? select;
}
