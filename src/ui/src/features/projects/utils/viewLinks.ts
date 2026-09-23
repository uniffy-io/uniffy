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
  /** The `view` query parameter as the URL has it now. */
  param: string | null;
  /** The parameter value the last step settled on. */
  settled: string | null;
  activeViewId: string | null;
  viewIds: readonly string[];
}

/**
 * One step of keeping `?view=` and the open view in agreement. A parameter the URL changed on its
 * own (a deep link, back or forward) opens that view when the caller can see it and is replaced by
 * the open view when not; otherwise the open view writes the parameter.
 */
export function nextViewParamStep(state: ViewParamState): {
  step: ViewParamStep;
  settled: string | null;
} {
  const { param, settled, activeViewId, viewIds } = state;
  if (param !== settled && param !== null && viewIds.includes(param)) {
    return {
      step: param === activeViewId ? { kind: "none" } : { kind: "open", viewId: param },
      settled: param,
    };
  }
  if (activeViewId !== null && activeViewId !== param) {
    return { step: { kind: "write", viewId: activeViewId }, settled: activeViewId };
  }
  return { step: { kind: "none" }, settled: param };
}
