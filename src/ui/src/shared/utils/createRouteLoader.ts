export interface RouteLoader<T> {
  load: () => Promise<T>;
  preload: () => void;
}

export function createRouteLoader<T>(factory: () => Promise<T>): RouteLoader<T> {
  let promise: Promise<T> | null = null;

  const load = () => {
    if (!promise) {
      promise = factory().catch((error: unknown) => {
        promise = null;
        throw error;
      });
    }

    return promise;
  };

  const preload = () => {
    void load().catch(() => undefined);
  };

  return { load, preload };
}
