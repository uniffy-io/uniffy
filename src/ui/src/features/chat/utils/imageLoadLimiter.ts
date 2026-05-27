/** Semaphore capping in-flight image loads so virtualised chat scrolls don't fan out hundreds of parallel requests. */

const MAX_CONCURRENT_IMAGES = 8;

interface Limiter {
  acquire: () => Promise<() => void>;
}

function createLimiter(maxConcurrent: number): Limiter {
  let active = 0;
  const queue: Array<(release: () => void) => void> = [];

  const release = (): void => {
    active -= 1;
    const next = queue.shift();
    if (next) {
      active += 1;
      next(release);
    }
  };

  return {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        if (active < maxConcurrent) {
          active += 1;
          resolve(release);
        } else {
          queue.push(resolve);
        }
      }),
  };
}

export const imageLoadLimiter = createLimiter(MAX_CONCURRENT_IMAGES);
