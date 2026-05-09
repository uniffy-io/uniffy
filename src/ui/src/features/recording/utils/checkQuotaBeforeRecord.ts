/**
 * Pre-flight quota check for the recording popover.
 *
 * Soft warning only: a 30-minute capture at default settings is ~150-300 MB,
 * so 2 GB free is comfortable. Below that we render a yellow banner; the
 * user can still hit Record. The hard cap is the server's quota check at
 * `complete_upload` (it aborts the multipart and refunds bytes if the user
 * blows the quota mid-capture).
 */

const SOFT_THRESHOLD_BYTES = 2 * 1024 * 1024 * 1024;

export interface QuotaCheckInput {
    quotaBytes: number | null;
    usedBytes: number;
}

export interface QuotaWarning {
    remainingBytes: number;
    message: string;
}

export function checkQuotaBeforeRecord(input: QuotaCheckInput): QuotaWarning | null {
    if (input.quotaBytes === null) return null;
    const remaining = input.quotaBytes - input.usedBytes;
    if (remaining >= SOFT_THRESHOLD_BYTES) return null;
    if (remaining <= 0) {
        return {
            remainingBytes: 0,
            message: 'Storage quota reached. Recording will fail at upload.',
        };
    }
    const remainingMb = Math.max(1, Math.round(remaining / (1024 * 1024)));
    return {
        remainingBytes: remaining,
        message: `Low storage: ${remainingMb} MB left. Recording may fail at upload.`,
    };
}
