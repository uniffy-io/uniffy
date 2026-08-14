import { lazy } from "react";
import type { ComponentType } from "react";

/** Adapter that lets `React.lazy` consume named exports - the codebase convention. */
export function lazyImport<T extends Record<string, unknown>, K extends keyof T>(
  factory: () => Promise<T>,
  name: K,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): React.LazyExoticComponent<ComponentType<any>> {
  return lazy(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory().then((module) => ({ default: module[name] as ComponentType<any> })),
  );
}
