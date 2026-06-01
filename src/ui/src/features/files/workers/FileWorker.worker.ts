import JSZip from 'jszip';
import type {
    WorkerRequest,
    UploadChunksRequest,
    CompressZipRequest,
    ConcatChunksRequest,
} from '@/features/files/workers/types';

const abortedOperations = new Set<string>();

const tokenRefreshPromises = new Map<string, {
    resolve: (token: string) => void;
    reject: (error: Error) => void;
}>();

const operationTokens = new Map<string, string>();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;

    if (request.type === 'ABORT') {
        abortedOperations.add(request.id);
        const pending = tokenRefreshPromises.get(request.id);
        if (pending) {
            pending.reject(new Error('Operation aborted'));
            tokenRefreshPromises.delete(request.id);
        }
        return;
    }

    if (request.type === 'TOKEN_REFRESH') {
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
            case 'UPLOAD_CHUNKS':
                await handleUploadChunks(request);
                break;
            case 'COMPRESS_ZIP':
                await handleCompressZip(request);
                break;
            case 'CONCAT_CHUNKS':
                await handleConcatChunks(request);
                break;
        }
    } catch (error) {
        self.postMessage({
            type: 'ERROR',
            id: request.id,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    } finally {
        abortedOperations.delete(request.id);
        operationTokens.delete(request.id);
        tokenRefreshPromises.delete(request.id);
    }
};

async function requestTokenRefresh(operationId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        tokenRefreshPromises.set(operationId, { resolve, reject });
        self.postMessage({ type: 'TOKEN_NEEDED', id: operationId });
    });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function uploadChunkWithRetry(
    operationId: string,
    apiUrl: string,
    uploadId: string,
    chunkNumber: number,
    data: ArrayBuffer,
    isLast: boolean,
    token: string,
    retryCount = 0
): Promise<void> {
    const maxRetries = 2;

    const response = await fetch(`${apiUrl}/files.v1.FilesService/UploadChunk`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            uploadId,
            chunkNumber,
            data: arrayBufferToBase64(data),
            isLast,
        }),
    });

    if (response.status === 401 && retryCount < maxRetries) {
        const newToken = await requestTokenRefresh(operationId);
        operationTokens.set(operationId, newToken);

        return uploadChunkWithRetry(
            operationId,
            apiUrl,
            uploadId,
            chunkNumber,
            data,
            isLast,
            newToken,
            retryCount + 1
        );
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
}

async function handleUploadChunks(request: UploadChunksRequest): Promise<void> {
    const { id, file, uploadId, chunkSize, totalChunks, token, apiUrl, completedChunks } = request;

    operationTokens.set(id, token);

    const alreadyStored = new Set(completedChunks ?? []);
    let uploadedBytes = 0;

    for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        if (abortedOperations.has(id)) {
            throw new Error('Operation aborted');
        }

        const start = (chunkNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);

        // On a resumed upload the server already has this part; count its bytes but skip the POST.
        if (alreadyStored.has(chunkNumber)) {
            uploadedBytes += end - start;
            self.postMessage({
                type: 'UPLOAD_PROGRESS',
                id,
                uploadedChunks: chunkNumber,
                uploadedBytes,
            });
            continue;
        }

        const chunkBlob = file.slice(start, end);
        const chunkData = await chunkBlob.arrayBuffer();

        const currentToken = operationTokens.get(id) || token;

        await uploadChunkWithRetry(
            id,
            apiUrl,
            uploadId,
            chunkNumber,
            chunkData,
            chunkNumber === totalChunks,
            currentToken
        );

        uploadedBytes += chunkData.byteLength;
        self.postMessage({
            type: 'UPLOAD_PROGRESS',
            id,
            uploadedChunks: chunkNumber,
            uploadedBytes,
        });
    }

    self.postMessage({
        type: 'UPLOAD_COMPLETE',
        id,
    });
}

async function handleCompressZip(request: CompressZipRequest): Promise<void> {
    const { id, files, compressionLevel } = request;
    const zip = new JSZip();

    for (let i = 0; i < files.length; i++) {
        if (abortedOperations.has(id)) {
            throw new Error('Operation aborted');
        }

        const { path, data } = files[i];
        zip.file(path, data, { binary: true });

        self.postMessage({
            type: 'COMPRESS_ZIP_PROGRESS',
            id,
            fileIndex: i + 1,
            totalFiles: files.length,
        });
    }

    const zipData = await zip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: compressionLevel },
    });

    // Transfer ownership for zero-copy.
    self.postMessage(
        {
            type: 'COMPRESS_ZIP_RESULT',
            id,
            zipData,
        },
        { transfer: [zipData] }
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
            type: 'CONCAT_CHUNKS_RESULT',
            id,
            data: result,
        },
        { transfer: [result] }
    );
}
