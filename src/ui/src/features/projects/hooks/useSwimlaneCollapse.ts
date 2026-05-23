import { useProjectCollapsedSet } from "./useProjectCollapsedSet";

export function useSwimlaneCollapse(projectId: string) {
  const { has, toggle } = useProjectCollapsedSet("board:lane-collapse", projectId);
  return { isCollapsed: has, toggle };
}
