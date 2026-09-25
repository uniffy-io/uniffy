import { isAction, type Middleware, type ThunkAction, type UnknownAction } from "@reduxjs/toolkit";
import { endsOrganizationScope } from "@/features/auth/store/authActions";

type ScopedThunk = ThunkAction<unknown, unknown, unknown, UnknownAction>;
type AbortableTask = PromiseLike<unknown> & { abort: () => void };

function isAbortableTask(value: unknown): value is AbortableTask {
  return (
    typeof value === "object" &&
    value !== null &&
    "abort" in value &&
    typeof value.abort === "function" &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** Thunk dispatches belong to the session that started them, including nested hydration actions. */
export const sessionScopeMiddleware: Middleware = () => {
  let generation = 0;
  const pending = new Set<AbortableTask>();

  return (next) => (action) => {
    if (isAction(action) && endsOrganizationScope(action)) {
      generation += 1;
      for (const task of pending) task.abort();
      pending.clear();
    }
    if (typeof action !== "function") return next(action);

    const scope = generation;
    const thunk = action as ScopedThunk;
    const guarded: ScopedThunk = (dispatch, getState, extra) =>
      thunk(
        ((child: UnknownAction | ScopedThunk) =>
          scope === generation ? dispatch(child as UnknownAction) : child) as typeof dispatch,
        getState,
        extra,
      );
    const result: unknown = next(guarded);
    if (isAbortableTask(result)) {
      if (scope !== generation) {
        result.abort();
      } else {
        pending.add(result);
        const settled = () => {
          pending.delete(result);
        };
        void result.then(settled, settled);
      }
    }
    return result;
  };
};
