/** Query parameter that names the open view on the project and task routes. */
export const VIEW_PARAM = "view";

export function viewLink(projectId: string, viewId: string): string {
  return `${window.location.origin}/projects/${projectId}?${VIEW_PARAM}=${encodeURIComponent(viewId)}`;
}

export type ViewParamStep =
  | { kind: "none" }
  | { kind: "open"; viewId: string }
  | { kind: "write"; viewId: string };

interface ViewParamState {
  projectId: string;
  /** The `view` query parameter as the URL has it now. */
  param: string | null;
  /** The parameter value the last step settled on. */
  settled: SettledViewParam | null;
  activeViewId: string | null;
  viewIds: readonly string[];
}

export interface SettledViewParam {
  projectId: string;
  param: string | null;
}

/** URL changes take priority over the remembered view within each project. */
export function nextViewParamStep(state: ViewParamState): {
  step: ViewParamStep;
  settled: SettledViewParam;
} {
  const { projectId, param, settled, activeViewId, viewIds } = state;
  if (
    (projectId !== settled?.projectId || param !== settled.param) &&
    param !== null &&
    viewIds.includes(param)
  ) {
    return {
      step: param === activeViewId ? { kind: "none" } : { kind: "open", viewId: param },
      settled: { projectId, param },
    };
  }
  if (activeViewId !== null && activeViewId !== param) {
    return {
      step: { kind: "write", viewId: activeViewId },
      settled: { projectId, param: activeViewId },
    };
  }
  return { step: { kind: "none" }, settled: { projectId, param } };
}
