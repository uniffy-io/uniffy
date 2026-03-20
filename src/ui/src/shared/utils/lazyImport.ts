import { lazy } from 'react';
import type { ComponentType } from 'react';

/**
 * Lazy-load a named export from a module.
 *
 * React.lazy requires a default export. This utility adapts a named export
 * to satisfy that requirement while keeping the project convention of named exports.
 *
 * Usage:
 *   const NotesPage = lazyImport(() => import('@/features/notes/pages/NotesPage'), 'NotesPage');
 */
export function lazyImport<
  T extends Record<string, unknown>,
  K extends keyof T,
>(
  factory: () => Promise<T>,
  name: K,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): React.LazyExoticComponent<ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() =>
    factory().then((module) => ({ default: module[name] as ComponentType<any> })),
  );
}
