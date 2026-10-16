/** Web Locks for one origin, which Node lacks: exclusive and shared modes, `ifAvailable`, and
 * grants decided in request order. Returns the uninstall. */
export function installWebLocks(): () => void {
  const held = new Map<string, { mode: LockMode; count: number }>();
  const waiting = new Map<string, (() => boolean)[]>();
  const grantable = (name: string, mode: LockMode) => {
    const current = held.get(name);
    return !current || (current.mode === "shared" && mode === "shared");
  };
  const release = (name: string) => {
    const current = held.get(name)!;
    current.count -= 1;
    if (current.count === 0) held.delete(name);
    const queue = waiting.get(name) ?? [];
    while (queue.length && queue[0]()) queue.shift();
  };
  const locks = {
    request<T>(
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => T,
    ): Promise<Awaited<T>> {
      const mode = options.mode ?? "exclusive";
      return new Promise((resolve, reject) => {
        const grant = () => {
          const current = held.get(name);
          held.set(name, { mode, count: (current?.count ?? 0) + 1 });
          void (async () => {
            // Browsers call back in a later task, never inside `request`.
            await Promise.resolve();
            try {
              resolve(await callback({ name, mode }));
            } catch (error) {
              reject(error);
            } finally {
              release(name);
            }
          })();
        };
        if (grantable(name, mode) && !waiting.get(name)?.length) grant();
        else if (options.ifAvailable)
          void (async () => {
            await Promise.resolve();
            try {
              resolve(await callback(null));
            } catch (error) {
              reject(error);
            }
          })();
        else {
          const queue = waiting.get(name) ?? [];
          waiting.set(name, queue);
          queue.push(() => {
            if (!grantable(name, mode)) return false;
            grant();
            return true;
          });
        }
      });
    },
  };
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  return () => {
    delete (navigator as { locks?: unknown }).locks;
  };
}
