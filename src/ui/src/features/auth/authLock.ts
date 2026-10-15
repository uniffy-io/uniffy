// Refresh and organization switches rotate the same credential across tabs.
export async function withAuthLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("uniffy:auth", work);
  }
  // IndexedDB also serializes tabs on HTTP origins where Web Locks is unavailable.
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("uniffy-auth-lock", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("mutex");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("mutex", "readwrite");
      const store = transaction.objectStore("mutex");
      let started = false;
      let finished = false;
      let result: T;
      let failure: unknown;
      let failed = false;
      const hold = () => {
        const request = store.get("refresh");
        request.onsuccess = () => {
          if (!started) {
            started = true;
            void work().then(
              (value) => {
                result = value;
                finished = true;
              },
              (error: unknown) => {
                failure = error;
                failed = true;
                finished = true;
              },
            );
          }
          if (!finished) hold();
        };
      };
      transaction.oncomplete = () => (failed ? reject(failure) : resolve(result));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Auth coordination failed"));
      transaction.onerror = () => reject(transaction.error);
      hold();
    });
  } finally {
    db.close();
  }
}
