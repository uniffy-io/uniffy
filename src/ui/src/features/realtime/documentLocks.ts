// Web Locks span every tab of this origin. An open editor holds its document's lock shared while it
// is attached, and a drain runs only when it takes the lock exclusively at once. Each session also
// claims the stored rows it writes or adopts until its close has written them, so an editor that
// reads the device again after a reconnect leaves the rows of a live editor or drain in another
// tab to that session. Together no tab replays the rows of an editor or of a drain in another tab.
// Plain HTTP origins have no Web Locks: there each tab sees only its own editors, and the server's
// deduplication keeps the data right.

function lockManager(): LockManager | null {
  return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
}

const lockName = (docName: string) => `uniffy:realtime:${docName}`;

/** Holds the document for an open editor until the returned release runs. */
export function holdOpenDocument(docName: string): () => void {
  const locks = lockManager();
  if (!locks) return () => {};
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  void locks.request(lockName(docName), { mode: "shared" }, () => released);
  return release;
}

/** Runs `work` while no editor or drain in any tab holds the document; null when one does. */
export async function whenDocumentFree<T>(
  docName: string,
  work: () => Promise<T>,
): Promise<T | null> {
  const locks = lockManager();
  if (!locks) return work();
  return locks.request(lockName(docName), { ifAvailable: true }, (lock) => (lock ? work() : null));
}

/** Claims the stored rows one writer session left for the document, or null while a live session
 * in any tab holds them. The returned release resolves once other tabs may claim them. */
export function claimDocumentRows(
  docName: string,
  writer: string,
): Promise<(() => Promise<void>) | null> {
  const locks = lockManager();
  if (!locks) return Promise.resolve(async () => {});
  return new Promise((resolve) => {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const request = locks
      .request(`${lockName(docName)}:rows:${writer}`, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return null;
        }
        resolve(async () => {
          release();
          await request;
        });
        return held;
      })
      // A lock manager that refuses the request leaves the rows to the server's deduplication.
      .catch(() => resolve(async () => {}));
  });
}
