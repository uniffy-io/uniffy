/** Soft 2 GB warning; hard cap lives in the server's quota check at `complete_upload`. */

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
      message: "Storage quota reached. Recording will fail at upload.",
    };
  }
  const remainingMb = Math.max(1, Math.round(remaining / (1024 * 1024)));
  return {
    remainingBytes: remaining,
    message: `Low storage: ${remainingMb} MB left. Recording may fail at upload.`,
  };
}
