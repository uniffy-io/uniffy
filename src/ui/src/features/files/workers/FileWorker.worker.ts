/**
 * File Worker
 *
 * Handles CPU-intensive file operations off the main thread:
 * - UPLOAD_CHUNKS: File slicing and chunk uploading
 * - COMPRESS_ZIP: ZIP archive creation with DEFLATE compression
 * - CONCAT_CHUNKS: Combining downloaded chunks into single buffer
 */

import JSZip from 'jszip';
import type {
    WorkerRequest,
    UploadChunksRequest,
    CompressZipRequest,
    ConcatChunksRequest,
} from '@/features/files/workers/types';

// Track aborted operations
const abortedOperations = new Set<string>();

// Pending token refresh promises (resolved when main thread sends TOKEN_REFRESH)
const tokenRefreshPromises = new Map<string, {
    resolve: (token: string) => void;
    reject: (error: Error) => void;
}>();

// Current token per operation (updated when TOKEN_REFRESH received)
const operationTokens = new Map<string, string>();

/**
 * Handle incoming messages from main thread.
 */
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;

    // Handle abort request
    if (request.type === 'ABORT') {
        abortedOperations.add(request.id);
        // Reject any pending token refresh
        const pending = tokenRefreshPromises.get(request.id);
        if (pending) {
            pending.reject(new Error('Operation aborted'));
            tokenRefreshPromises.delete(request.id);
        }
        return;
    }

    // Handle token refresh from main thread
    if (request.type === 'TOKEN_REFRESH') {
        operationTokens.set(request.id, request.token);
        const pending = tokenRefreshPromises.get(request.id);
        if (pending) {
            pending.resolve(request.token);
            tokenRefreshPromises.delete(request.id);
        }
        return;
    }

    // Process operation requests
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
        // Cleanup
        abortedOperations.delete(request.id);
        operationTokens.delete(request.id);
        tokenRefreshPromises.delete(request.id);
    }
};

/**
 * Request a fresh token from main thread and wait for it.
 */
async function requestTokenRefresh(operationId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        tokenRefreshPromises.set(operationId, { resolve, reject });
        self.postMessage({ type: 'TOKEN_NEEDED', id: operationId });
    });
}

/**
 * Convert ArrayBuffer to base64 string for JSON transport.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Upload a single chunk with retry on 401.
 */
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
        // Token expired, request a new one
        const newToken = await requestTokenRefresh(operationId);
        operationTokens.set(operationId, newToken);

        // Retry with new token
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

/**
 * Handle UPLOAD_CHUNKS: slice file and upload each chunk.
 */
async function handleUploadChunks(request: UploadChunksRequest): Promise<void> {
    const { id, file, uploadId, chunkSize, totalChunks, token, apiUrl } = request;

    // Store initial token
    operationTokens.set(id, token);

    let uploadedBytes = 0;

    for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        // Check for abort
        if (abortedOperations.has(id)) {
            throw new Error('Operation aborted');
        }

        // Slice file chunk
        const start = (chunkNumber - 1) * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunkBlob = file.slice(start, end);
        const chunkData = await chunkBlob.arrayBuffer();

        // Get current token (may have been refreshed)
        const currentToken = operationTokens.get(id) || token;

        // Upload chunk with retry on 401
        await uploadChunkWithRetry(
            id,
            apiUrl,
            uploadId,
            chunkNumber,
            chunkData,
            chunkNumber === totalChunks,
            currentToken
        );

        // Update progress
        uploadedBytes += chunkData.byteLength;
        self.postMessage({
            type: 'UPLOAD_PROGRESS',
            id,
            uploadedChunks: chunkNumber,
            uploadedBytes,
        });
    }

    // All chunks uploaded
    self.postMessage({
        type: 'UPLOAD_COMPLETE',
        id,
    });
}

/**
 * Handle COMPRESS_ZIP: create ZIP archive with DEFLATE compression.
 */
async function handleCompressZip(request: CompressZipRequest): Promise<void> {
    const { id, files, compressionLevel } = request;
    const zip = new JSZip();

    // Add files to ZIP
    for (let i = 0; i < files.length; i++) {
        // Check for abort
        if (abortedOperations.has(id)) {
            throw new Error('Operation aborted');
        }

        const { path, data } = files[i];
        zip.file(path, data, { binary: true });

        // Report progress
        self.postMessage({
            type: 'COMPRESS_ZIP_PROGRESS',
            id,
            fileIndex: i + 1,
            totalFiles: files.length,
        });
    }

    // Generate ZIP with compression
    const zipData = await zip.generateAsync({
        type: 'arraybuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: compressionLevel },
    });

    // Send result (transfer ownership for zero-copy)
    self.postMessage(
        {
            type: 'COMPRESS_ZIP_RESULT',
            id,
            zipData,
        },
        { transfer: [zipData] }
    );
}

/**
 * Handle CONCAT_CHUNKS: combine multiple ArrayBuffers into one.
 */
async function handleConcatChunks(request: ConcatChunksRequest): Promise<void> {
    const { id, chunks } = request;

    // Calculate total size
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);

    // Allocate result buffer
    const result = new ArrayBuffer(totalSize);
    const view = new Uint8Array(result);

    // Copy chunks
    let offset = 0;
    for (const chunk of chunks) {
        view.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }

    // Send result (transfer ownership for zero-copy)
    self.postMessage(
        {
            type: 'CONCAT_CHUNKS_RESULT',
            id,
            data: result,
        },
        { transfer: [result] }
    );
}
