// 2MB cap lets video quick-start without buffering the whole file.
export const MAX_INITIAL_CHUNK_SIZE = 2 * 1024 * 1024;

/**
 * Builds an RFC 5987 Content-Disposition value. Non-ASCII filenames otherwise
 * throw "String contains non ISO-8859-1 code point" when set on a Response.
 */
export function buildContentDisposition(filename: string): string {
    const asciiName = filename.replace(/[^\x20-\x7E]|["\\]/g, '_');

    const hasNonAscii = /[^\x20-\x7E]/.test(filename);
    if (!hasNonAscii) {
        return `inline; filename="${asciiName}"`;
    }

    const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
    return `inline; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

/**
 * Returns `hasRangeHeader` so the caller can pick 200 vs 206. The 2MB cap
 * applies only when the browser sent an explicit Range AND `requestFullFile`
 * is false - `<audio>` initial loads need a full 200 response, an unsolicited
 * 206 trips browser media demuxers.
 */
export function parseRangeRequest(
    rangeHeader: string | null,
    requestFullFile: boolean
): { startByte: number; endByte: number | undefined; hasRangeHeader: boolean } {
    let startByte: number | undefined;
    let endByte: number | undefined;
    let hasRangeHeader = false;

    if (rangeHeader) {
        hasRangeHeader = true;
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            startByte = parseInt(match[1], 10);
            endByte = match[2] ? parseInt(match[2], 10) : undefined;
        }
    }

    if (startByte === undefined) {
        startByte = 0;
    }

    if (hasRangeHeader && !requestFullFile && (endByte === undefined || endByte - startByte > MAX_INITIAL_CHUNK_SIZE)) {
        endByte = startByte + MAX_INITIAL_CHUNK_SIZE - 1;
    }

    return { startByte, endByte, hasRangeHeader };
}
