import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  UploadChunkRequestSchema,
  UploadChunkResponseSchema,
} from "@uniffy/proto/files/v1/files_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  UploadChunksRequest,
  WorkerRequest,
  WorkerResponse,
} from "@/features/files/workers/types";

const worker = {
  importScripts: vi.fn(),
  setTimeout,
  clearTimeout,
  onmessage: undefined as ((event: MessageEvent<WorkerRequest>) => Promise<void>) | undefined,
  postMessage: vi.fn<(message: WorkerResponse) => void>(),
};
const fetchMock = vi.fn<typeof fetch>();
const requests: Request[] = [];
const fileBytes = new Uint8Array([0, 128, 255, 1, 254, 2, 253, 3]);

function upload(overrides: Partial<UploadChunksRequest> = {}): UploadChunksRequest {
  return {
    type: "UPLOAD_CHUNKS",
    id: "operation-1",
    file: new Blob([fileBytes]),
    uploadId: "upload-1",
    chunkSize: 3,
    totalChunks: 3,
    token: "access-token",
    apiUrl: "https://example.test/api",
    ...overrides,
  };
}

async function send(data: WorkerRequest): Promise<void> {
  await worker.onmessage!({ data } as MessageEvent<WorkerRequest>);
}

function success(): Response {
  return new Response(
    new Uint8Array(toBinary(UploadChunkResponseSchema, create(UploadChunkResponseSchema))),
    { headers: { "content-type": "application/proto" } },
  );
}

function unauthenticated(): Response {
  return Response.json({ code: "unauthenticated", message: "Token expired" }, { status: 401 });
}

function refreshTokens(): void {
  worker.postMessage.mockImplementation((message) => {
    if (message.type === "TOKEN_NEEDED") {
      void send({ type: "TOKEN_REFRESH", id: message.id, token: "refreshed-token" });
    }
  });
}

function messages(): WorkerResponse[] {
  return worker.postMessage.mock.calls.map(([message]) => message);
}

async function decode(request: Request) {
  return fromBinary(UploadChunkRequestSchema, new Uint8Array(await request.arrayBuffer()));
}

function holdRequests() {
  const held: Array<{ request: Request; finish: (response?: Response) => void }> = [];
  fetchMock.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    requests.push(request);
    return new Promise<Response>((resolve, reject) => {
      const abort = () => reject(request.signal.reason);
      request.signal.addEventListener("abort", abort, { once: true });
      held.push({
        request,
        finish: (response = success()) => {
          request.signal.removeEventListener("abort", abort);
          resolve(response);
        },
      });
    });
  });
  return held;
}

beforeEach(async () => {
  vi.resetModules();
  worker.postMessage.mockReset();
  requests.length = 0;
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    requests.push(new Request(input, init));
    return success();
  });
  vi.stubGlobal("self", worker);
  vi.stubGlobal("fetch", fetchMock);
  await import("@/features/files/workers/FileWorker.worker");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FileWorker uploads", () => {
  it("uploads two chunks at once and reports completed bytes in completion order", async () => {
    const held = holdRequests();
    const done = send(upload());
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1].finish();
    await vi.waitFor(() => expect(held).toHaveLength(3));
    held[2].finish();
    await vi.waitFor(() =>
      expect(messages().filter((m) => m.type === "UPLOAD_PROGRESS")).toHaveLength(2),
    );
    expect(messages().some((m) => m.type === "UPLOAD_COMPLETE")).toBe(false);
    held[0].finish();
    await done;
    expect(messages()).toEqual([
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 1, uploadedBytes: 3 },
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 2, uploadedBytes: 5 },
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 3, uploadedBytes: 8 },
      { type: "UPLOAD_COMPLETE", id: "operation-1" },
    ]);
  });

  it.each([
    ["http/1.1", 3],
    ["h2", 8],
    ["h3", 8],
  ])("shares a bounded request budget across uploads on %s", async (httpProtocol, limit) => {
    const held = holdRequests();
    const done = Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        send(
          upload({
            id: `operation-${i}`,
            uploadId: `upload-${i}`,
            httpProtocol: String(httpProtocol),
            file: new Blob([new Uint8Array(12)]),
            chunkSize: 3,
            totalChunks: 4,
          }),
        ),
      ),
    );
    await vi.waitFor(() => expect(held).toHaveLength(Number(limit)));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(Number(limit));
    for (let i = 0; i < 12; i++) {
      await vi.waitFor(() => expect(held.length).toBeGreaterThan(i));
      held[i].finish();
    }
    await done;
    expect(messages().filter((m) => m.type === "UPLOAD_COMPLETE")).toHaveLength(3);
  });

  it("bounds buffered chunk bytes even on HTTP/2", async () => {
    const held = holdRequests();
    const chunkSize = 50 * 1024 ** 2;
    const part = new Blob([new Uint8Array(chunkSize)]);
    const done = send(
      upload({ file: new Blob([part, part, part]), chunkSize, totalChunks: 3, httpProtocol: "h2" }),
    );
    await vi.waitFor(() => expect(held).toHaveLength(2));
    await send({ type: "ABORT", id: "operation-1" });
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(held.every(({ request }) => request.signal.aborted)).toBe(true);
  });

  it("coalesces auth refresh across simultaneous expired chunks", async () => {
    const held = holdRequests();
    const done = send(upload());
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[0].finish(unauthenticated());
    held[1].finish(unauthenticated());
    await vi.waitFor(() =>
      expect(messages().filter((m) => m.type === "TOKEN_NEEDED")).toHaveLength(1),
    );
    await send({ type: "TOKEN_REFRESH", id: "operation-1", token: "fresh-token" });
    await vi.waitFor(() => expect(held).toHaveLength(4));
    expect(held[2].request.headers.get("authorization")).toBe("Bearer fresh-token");
    expect(held[3].request.headers.get("authorization")).toBe("Bearer fresh-token");
    held[2].finish();
    held[3].finish();
    await vi.waitFor(() => expect(held).toHaveLength(5));
    expect(held[4].request.headers.get("authorization")).toBe("Bearer fresh-token");
    held[4].finish();
    await done;
    expect(messages().filter((m) => m.type === "TOKEN_NEEDED")).toHaveLength(1);
    expect(messages().at(-1)?.type).toBe("UPLOAD_COMPLETE");
  });

  it("aborts sibling requests after failure and releases slots for another upload", async () => {
    const held = holdRequests();
    const done = send(upload());
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[0].finish(
      Response.json({ code: "permission_denied", message: "Upload denied" }, { status: 403 }),
    );
    await done;
    expect(held[1].request.signal.aborted).toBe(true);
    expect(messages().at(-1)).toMatchObject({
      type: "ERROR",
      error: expect.stringContaining("Upload denied"),
    });
    const next = send(upload({ id: "next", chunkSize: fileBytes.length, totalChunks: 1 }));
    await vi.waitFor(() => expect(held).toHaveLength(3));
    held[2].finish();
    await next;
    expect(messages().at(-1)).toEqual({ type: "UPLOAD_COMPLETE", id: "next" });
  });

  it("cancels queued and active chunks without retaining request slots", async () => {
    const held = holdRequests();
    const first = send(upload());
    const second = send(upload({ id: "second" }));
    await vi.waitFor(() => expect(held).toHaveLength(3));
    await send({ type: "ABORT", id: "second" });
    await second;
    await send({ type: "ABORT", id: "operation-1" });
    await first;
    expect(held.every(({ request }) => request.signal.aborted)).toBe(true);
    const next = send(upload({ id: "next", chunkSize: fileBytes.length, totalChunks: 1 }));
    await vi.waitFor(() => expect(held).toHaveLength(4));
    held[3].finish();
    await next;
    expect(messages().at(-1)).toEqual({ type: "UPLOAD_COMPLETE", id: "next" });
  });

  it("sends binary protobuf with bearer auth and reports byte progress", async () => {
    await send(upload());

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toBe("https://example.test/api/files.v1.FilesService/UploadChunk");
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toBe("application/proto");
      expect(request.headers.get("connect-protocol-version")).toBe("1");
      expect(request.headers.get("authorization")).toBe("Bearer access-token");
    }
    const chunks = (await Promise.all(requests.map(decode))).sort(
      (a, b) => a.chunkNumber - b.chunkNumber,
    );
    expect(
      chunks.map(({ uploadId, chunkNumber, isLast }) => ({ uploadId, chunkNumber, isLast })),
    ).toEqual([
      { uploadId: "upload-1", chunkNumber: 1, isLast: false },
      { uploadId: "upload-1", chunkNumber: 2, isLast: false },
      { uploadId: "upload-1", chunkNumber: 3, isLast: true },
    ]);
    expect(new Uint8Array(chunks.flatMap(({ data }) => [...data]))).toEqual(fileBytes);
    expect(messages()).toEqual([
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 1, uploadedBytes: 3 },
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 2, uploadedBytes: 6 },
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 3, uploadedBytes: 8 },
      { type: "UPLOAD_COMPLETE", id: "operation-1" },
    ]);
  });

  it("encodes a 50 MiB chunk without base64 expansion", async () => {
    const data = new Uint8Array(50 * 1024 ** 2).fill(255);
    await send(upload({ file: new Blob([data]), chunkSize: data.length, totalChunks: 1 }));

    expect(requests).toHaveLength(1);
    const body = new Uint8Array(await requests[0].arrayBuffer());
    expect(body.length).toBeLessThan(data.length + 100);
    const chunk = fromBinary(UploadChunkRequestSchema, body);
    expect(Buffer.compare(chunk.data, data)).toBe(0);
    expect(chunk.isLast).toBe(true);
    expect(messages().at(-1)?.type).toBe("UPLOAD_COMPLETE");
  });

  it("skips stored chunks while preserving resumed progress", async () => {
    await send(upload({ completedChunks: [1, 3] }));

    expect(requests).toHaveLength(1);
    const chunk = await decode(requests[0]);
    expect(chunk.chunkNumber).toBe(2);
    expect(chunk.data).toEqual(fileBytes.slice(3, 6));
    expect(messages()).toEqual([
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 1, uploadedBytes: 3 },
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 2, uploadedBytes: 5 },
      { type: "UPLOAD_PROGRESS", id: "operation-1", uploadedChunks: 3, uploadedBytes: 8 },
      { type: "UPLOAD_COMPLETE", id: "operation-1" },
    ]);
  });

  it.each(["connect", "http"])(
    "refreshes after a %s auth error and retries identical bytes",
    async (kind) => {
      fetchMock.mockImplementationOnce(async (input, init) => {
        requests.push(new Request(input, init));
        return kind === "connect" ? unauthenticated() : new Response(null, { status: 401 });
      });
      refreshTokens();

      await send(
        upload({ file: new Blob([fileBytes]), chunkSize: fileBytes.length, totalChunks: 1 }),
      );

      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
        "Bearer access-token",
        "Bearer refreshed-token",
      ]);
      expect(await decode(requests[0])).toEqual(await decode(requests[1]));
      expect(messages().filter(({ type }) => type === "TOKEN_NEEDED")).toHaveLength(1);
      expect(messages().filter(({ type }) => type === "UPLOAD_PROGRESS")).toHaveLength(1);
      expect(messages().at(-1)?.type).toBe("UPLOAD_COMPLETE");
    },
  );

  it("stops after two refresh retries", async () => {
    fetchMock.mockImplementation(async () => unauthenticated());
    refreshTokens();

    await send(upload({ chunkSize: fileBytes.length, totalChunks: 1 }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(messages().filter(({ type }) => type === "TOKEN_NEEDED")).toHaveLength(2);
    expect(messages().at(-1)).toMatchObject({ type: "ERROR", id: "operation-1" });
    expect(messages().some(({ type }) => type === "UPLOAD_COMPLETE")).toBe(false);
  });

  it("reports permission failures without requesting another token", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ code: "permission_denied", message: "Upload denied" }, { status: 403 }),
    );

    await send(upload({ chunkSize: fileBytes.length, totalChunks: 1 }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([
      { type: "ERROR", id: "operation-1", error: expect.stringContaining("Upload denied") },
    ]);
  });

  it("stops before the next chunk after cancellation", async () => {
    fetchMock.mockImplementationOnce(async () => {
      await send({ type: "ABORT", id: "operation-1" });
      return success();
    });

    await send(upload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(messages().at(-1)).toEqual({
      type: "ERROR",
      id: "operation-1",
      error: "Operation aborted",
    });
    expect(messages().some(({ type }) => type === "UPLOAD_COMPLETE")).toBe(false);
  });

  it("cancels while waiting for a refreshed token", async () => {
    fetchMock.mockImplementation(async () => unauthenticated());
    worker.postMessage.mockImplementation((message) => {
      if (message.type === "TOKEN_NEEDED") {
        void send({ type: "ABORT", id: message.id });
      }
    });

    await send(upload({ chunkSize: fileBytes.length, totalChunks: 1 }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(messages().at(-1)).toEqual({
      type: "ERROR",
      id: "operation-1",
      error: "Operation aborted",
    });
  });
});
