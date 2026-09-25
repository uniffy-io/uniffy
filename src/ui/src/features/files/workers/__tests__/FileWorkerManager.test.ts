import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "@/features/files/workers/types";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent<WorkerResponse>) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn<(message: WorkerRequest) => void>();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  emit(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  }
}

const options = {
  file: new Blob([new Uint8Array(8)]),
  uploadId: "upload",
  chunkSize: 4,
  totalChunks: 2,
  apiUrl: "/api",
  operationId: "operation",
};

beforeEach(() => {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
  vi.stubGlobal("location", { href: "https://example.test/files", origin: "https://example.test" });
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["http/1.1", "h2", "h3"])("uses observed API protocol %s", async (protocol) => {
  vi.mocked(performance.getEntriesByType).mockImplementation((type) =>
    type === "resource"
      ? ([
          {
            name: "https://example.test/api/auth.v1.AuthService/GetCurrentUser",
            nextHopProtocol: protocol,
          },
        ] as PerformanceResourceTiming[])
      : ([{ nextHopProtocol: "h2" }] as PerformanceNavigationTiming[]),
  );
  const { FileWorkerManager } = await import("@/features/files/workers/FileWorkerManager");
  const manager = new FileWorkerManager();
  manager.init(
    () => "token",
    async () => "fresh",
  );
  const done = manager.uploadChunks(options);
  const worker = FakeWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "UPLOAD_CHUNKS", httpProtocol: protocol }),
  );
  worker.emit({ type: "UPLOAD_COMPLETE", id: "operation" });
  await done;
});

it("does not assume cross-origin API uses page HTTP/2", async () => {
  vi.mocked(performance.getEntriesByType).mockImplementation((type) =>
    type === "navigation" ? ([{ nextHopProtocol: "h2" }] as PerformanceNavigationTiming[]) : [],
  );
  const { FileWorkerManager } = await import("@/features/files/workers/FileWorkerManager");
  const manager = new FileWorkerManager();
  manager.init(
    () => "token",
    async () => "fresh",
  );
  const done = manager.uploadChunks({ ...options, apiUrl: "https://api.example.test/api" });
  const worker = FakeWorker.instances[0];
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ httpProtocol: "" }));
  worker.emit({ type: "UPLOAD_COMPLETE", id: "operation" });
  await done;
});

it("shares upload worker across files and keeps ZIP work separate", async () => {
  const { FileWorkerManager } = await import("@/features/files/workers/FileWorkerManager");
  const manager = new FileWorkerManager();
  manager.init(
    () => "token",
    async () => "fresh",
  );
  const first = manager.uploadChunks(options);
  const second = manager.uploadChunks({ ...options, operationId: "second" });
  const zip = manager.compressZip({ files: [] });
  const [uploads, zipWorker] = FakeWorker.instances;
  expect(uploads.postMessage).toHaveBeenCalledTimes(2);
  expect(zipWorker.postMessage).toHaveBeenCalledTimes(1);
  uploads.emit({ type: "UPLOAD_COMPLETE", id: "operation" });
  uploads.emit({ type: "UPLOAD_COMPLETE", id: "second" });
  zipWorker.emit({
    type: "COMPRESS_ZIP_RESULT",
    id: zipWorker.postMessage.mock.calls[0][0].id,
    zipData: new ArrayBuffer(0),
  });
  await Promise.all([first, second, zip]);
});

it.each(["empty", "throws"])("aborts worker when auth refresh %s", async (failure) => {
  const { FileWorkerManager } = await import("@/features/files/workers/FileWorkerManager");
  const manager = new FileWorkerManager();
  manager.init(
    () => "token",
    async () => {
      if (failure === "throws") throw new Error("Offline");
      return null;
    },
  );
  const done = manager.uploadChunks(options);
  const rejected = expect(done).rejects.toThrow("Authentication failed");
  const worker = FakeWorker.instances[0];
  worker.emit({ type: "TOKEN_NEEDED", id: "operation" });
  await rejected;
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "ABORT", id: "operation" });
});

it("does not revive cancelled upload after token refresh completes", async () => {
  let finishRefresh!: (token: string) => void;
  const refresh = new Promise<string>((resolve) => {
    finishRefresh = resolve;
  });
  const { FileWorkerManager } = await import("@/features/files/workers/FileWorkerManager");
  const manager = new FileWorkerManager();
  manager.init(
    () => "token",
    () => refresh,
  );
  const done = manager.uploadChunks(options);
  const rejected = expect(done).rejects.toThrow("Operation aborted");
  const worker = FakeWorker.instances[0];
  worker.emit({ type: "TOKEN_NEEDED", id: "operation" });
  manager.abort("operation");
  await rejected;
  finishRefresh("fresh");
  await Promise.resolve();
  expect(worker.postMessage.mock.calls.some(([message]) => message.type === "TOKEN_REFRESH")).toBe(
    false,
  );
  expect(FakeWorker.instances.slice(1).every((w) => w.postMessage.mock.calls.length === 0)).toBe(
    true,
  );
});
