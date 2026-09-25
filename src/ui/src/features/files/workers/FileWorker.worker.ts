import { Code, ConnectError, createClient, type Client } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { FilesService } from "@uniffy/proto/files/v1/files_pb";
import JSZip from "jszip";
import type {
  WorkerRequest,
  UploadChunksRequest,
  CompressZipRequest,
  ConcatChunksRequest,
} from "@/features/files/workers/types";

const abortedOperations = new Set<string>();
const uploadControllers = new Map<string, AbortController>();
const uploadSlotWaiters: Array<{ bytes: number; ready: () => void }> = [];
const uploadConcurrencyLimits = new Map<string, number>();
let activeUploadChunks = 0;
let activeUploadBytes = 0;
const UPLOAD_BUFFER_BUDGET = 128 * 1024 ** 2;

const tokenRefreshPromises = new Map<
  string,
  {
    promise: Promise<string>;
    resolve: (token: string) => void;
    reject: (error: Error) => void;
  }
>();

const operationTokens = new Map<string, string>();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === "ABORT") {
    abortedOperations.add(request.id);
    uploadControllers.get(request.id)?.abort(new Error("Operation aborted"));
    const pending = tokenRefreshPromises.get(request.id);
    if (pending) {
      pending.reject(new Error("Operation aborted"));
      tokenRefreshPromises.delete(request.id);
    }
    return;
  }

  if (request.type === "TOKEN_REFRESH") {
    operationTokens.set(request.id, request.token);
    const pending = tokenRefreshPromises.get(request.id);
    if (pending) {
      pending.resolve(request.token);
      tokenRefreshPromises.delete(request.id);
    }
    return;
  }

  try {
    switch (request.type) {
      case "UPLOAD_CHUNKS":
        await handleUploadChunks(request);
        break;
      case "COMPRESS_ZIP":
        await handleCompressZip(request);
        break;
      case "CONCAT_CHUNKS":
        await handleConcatChunks(request);
        break;
    }
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      id: request.id,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    uploadControllers.delete(request.id);
    uploadConcurrencyLimits.delete(request.id);
    drainUploadSlots();
    abortedOperations.delete(request.id);
    operationTokens.delete(request.id);
    tokenRefreshPromises.delete(request.id);
  }
};

async function requestTokenRefresh(operationId: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const pending = tokenRefreshPromises.get(operationId);
  if (pending) return pending.promise;

  let resolve!: (token: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const abort = () => reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  tokenRefreshPromises.set(operationId, { promise, resolve, reject });
  try {
    self.postMessage({ type: "TOKEN_NEEDED", id: operationId });
    return await promise;
  } finally {
    signal.removeEventListener("abort", abort);
    tokenRefreshPromises.delete(operationId);
  }
}

async function acquireUploadSlot(bytes: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (bytes > UPLOAD_BUFFER_BUDGET) throw new Error("Upload chunk exceeds memory budget");
  await new Promise<void>((resolve, reject) => {
    const waiter = {
      bytes,
      ready: () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
    };
    const abort = () => {
      const index = uploadSlotWaiters.indexOf(waiter);
      if (index !== -1) uploadSlotWaiters.splice(index, 1);
      reject(signal.reason);
      drainUploadSlots();
    };
    signal.addEventListener("abort", abort, { once: true });
    uploadSlotWaiters.push(waiter);
    drainUploadSlots();
  });
}

function drainUploadSlots(): void {
  const limit = Math.min(...uploadConcurrencyLimits.values());
  while (uploadSlotWaiters.length && activeUploadChunks < limit) {
    const next = uploadSlotWaiters[0];
    if (activeUploadBytes + next.bytes > UPLOAD_BUFFER_BUDGET) break;
    uploadSlotWaiters.shift();
    activeUploadChunks++;
    activeUploadBytes += next.bytes;
    next.ready();
  }
}

function releaseUploadSlot(bytes: number): void {
  activeUploadChunks--;
  activeUploadBytes -= bytes;
  drainUploadSlots();
}

async function uploadChunkWithRetry(
  operationId: string,
  client: Client<typeof FilesService>,
  uploadId: string,
  chunkNumber: number,
  data: ArrayBuffer,
  isLast: boolean,
  token: string,
  signal: AbortSignal,
  retryCount = 0,
): Promise<void> {
  const maxRetries = 2;

  try {
    await client.uploadChunk(
      { uploadId, chunkNumber, data: new Uint8Array(data), isLast },
      { headers: { Authorization: `Bearer ${token}` }, signal },
    );
  } catch (error) {
    if (ConnectError.from(error).code !== Code.Unauthenticated || retryCount >= maxRetries) {
      throw error;
    }

    signal.throwIfAborted();
    const currentToken = operationTokens.get(operationId);
    const newToken =
      currentToken && currentToken !== token
        ? currentToken
        : await requestTokenRefresh(operationId, signal);
    operationTokens.set(operationId, newToken);

    return uploadChunkWithRetry(
      operationId,
      client,
      uploadId,
      chunkNumber,
      data,
      isLast,
      newToken,
      signal,
      retryCount + 1,
    );
  }
}

async function handleUploadChunks(request: UploadChunksRequest): Promise<void> {
  const { id, file, uploadId, chunkSize, totalChunks, token, apiUrl, completedChunks } = request;
  const client = createClient(
    FilesService,
    createConnectTransport({ baseUrl: apiUrl, useBinaryFormat: true }),
  );
  const controller = new AbortController();
  uploadControllers.set(id, controller);
  const { signal } = controller;
  const multiplexed = request.httpProtocol === "h2" || request.httpProtocol?.startsWith("h3");
  // HTTP/1.1 uploads leave connections available for navigation and notification streams.
  uploadConcurrencyLimits.set(id, multiplexed ? 8 : 3);
  const chunkConcurrency = multiplexed ? 4 : 2;

  operationTokens.set(id, token);

  const alreadyStored = new Set(completedChunks ?? []);
  let uploadedBytes = 0;
  let uploadedChunks = 0;
  let nextChunk = 1;

  const reportProgress = (bytes: number) => {
    uploadedBytes += bytes;
    uploadedChunks++;
    self.postMessage({ type: "UPLOAD_PROGRESS", id, uploadedChunks, uploadedBytes });
  };

  for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
    if (alreadyStored.has(chunkNumber)) {
      reportProgress(Math.min(chunkSize, file.size - (chunkNumber - 1) * chunkSize));
    }
  }

  const sendChunks = async () => {
    while (nextChunk <= totalChunks) {
      signal.throwIfAborted();
      const chunkNumber = nextChunk++;
      if (alreadyStored.has(chunkNumber)) continue;

      const start = (chunkNumber - 1) * chunkSize;
      const bytes = Math.min(chunkSize, file.size - start);
      await acquireUploadSlot(bytes, signal);
      try {
        signal.throwIfAborted();
        const chunkData = await file.slice(start, start + chunkSize).arrayBuffer();
        signal.throwIfAborted();
        await uploadChunkWithRetry(
          id,
          client,
          uploadId,
          chunkNumber,
          chunkData,
          chunkNumber === totalChunks,
          operationTokens.get(id) || token,
          signal,
        );
        signal.throwIfAborted();
        reportProgress(chunkData.byteLength);
      } finally {
        releaseUploadSlot(bytes);
      }
    }
  };
  const runners = Array.from({ length: Math.min(chunkConcurrency, totalChunks) }, sendChunks);
  try {
    await Promise.all(runners);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled(runners);
    throw signal.reason;
  }
  signal.throwIfAborted();

  self.postMessage({
    type: "UPLOAD_COMPLETE",
    id,
  });
}

async function handleCompressZip(request: CompressZipRequest): Promise<void> {
  const { id, files, compressionLevel } = request;
  const zip = new JSZip();

  for (let i = 0; i < files.length; i++) {
    if (abortedOperations.has(id)) {
      throw new Error("Operation aborted");
    }

    const { path, data } = files[i];
    zip.file(path, data, { binary: true });

    self.postMessage({
      type: "COMPRESS_ZIP_PROGRESS",
      id,
      fileIndex: i + 1,
      totalFiles: files.length,
    });
  }

  const zipData = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: compressionLevel },
  });

  // Transfer ownership for zero-copy.
  self.postMessage(
    {
      type: "COMPRESS_ZIP_RESULT",
      id,
      zipData,
    },
    { transfer: [zipData] },
  );
}

async function handleConcatChunks(request: ConcatChunksRequest): Promise<void> {
  const { id, chunks } = request;

  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);

  const result = new ArrayBuffer(totalSize);
  const view = new Uint8Array(result);

  let offset = 0;
  for (const chunk of chunks) {
    view.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  // Transfer ownership for zero-copy.
  self.postMessage(
    {
      type: "CONCAT_CHUNKS_RESULT",
      id,
      data: result,
    },
    { transfer: [result] },
  );
}
