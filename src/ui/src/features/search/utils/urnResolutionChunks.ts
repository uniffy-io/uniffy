export const URN_RESOLUTION_CONCURRENCY = 3;

interface UrnResolutionChunkOptions<T> {
  signal: AbortSignal;
  resolve: (urns: string[], signal: AbortSignal) => Promise<T>;
  onResolved: (result: T) => void;
  concurrency?: number;
}

export async function resolveUrnChunks<T>(
  chunks: string[][],
  options: UrnResolutionChunkOptions<T>,
): Promise<void> {
  if (chunks.length === 0) return;

  const concurrency = options.concurrency ?? URN_RESOLUTION_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("URN resolution concurrency must be a positive integer");
  }

  let nextIndex = 0;
  let failure: unknown;

  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      options.signal.throwIfAborted();
      const index = nextIndex;
      nextIndex += 1;
      if (index >= chunks.length) return;

      try {
        const result = await options.resolve(chunks[index], options.signal);
        if (failure !== undefined) return;
        options.signal.throwIfAborted();
        options.onResolved(result);
      } catch (error) {
        failure = error;
      }
    }
  };

  const workerCount = Math.min(concurrency, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  options.signal.throwIfAborted();
  if (failure !== undefined) throw failure;
}
