/**
 * Image-load concurrency limiter.
 *
 * The chat scroll path can mount 100+ <img> elements at once when
 * the user scrolls into a region with image attachments. Native
 * `loading="lazy"` defers but does not throttle once the images
 * are in viewport, which means the browser fans out hundreds of
 * parallel HTTP requests against the auth-proxied media stream.
 * This module-level semaphore caps in-flight image loads to
 * `MAX_CONCURRENT_IMAGES`. Callers acquire a slot, set their
 * `<img src>`, and release on load or error.
 */

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
