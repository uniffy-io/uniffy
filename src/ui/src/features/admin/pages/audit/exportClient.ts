import { toast } from "sonner";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { friendlyErrorMessage } from "@/config";
import { formatFileSize } from "@/shared/utils/dateFormatting";
import { downloadBlob } from "@/shared/utils/download";
import { auditApi } from "@/features/admin/api/auditApi";
import type { AuditFilter } from "@/components/audit";

interface ExportArgs {
  organizationId: string;
  organizationSlug: string;
  filter: AuditFilter;
  format: "csv" | "json";
}

const EXPORT_FORMAT_CSV = 1;
const EXPORT_FORMAT_JSON = 2;

export async function exportCurrentView({
  organizationId,
  organizationSlug,
  filter,
  format,
}: ExportArgs): Promise<void> {
  const filename = buildFilename(organizationSlug, format);
  const fromTime = filter.fromTime ? new Date(filter.fromTime) : undefined;
  const toTime = filter.toTime ? new Date(filter.toTime) : undefined;

  const progress = toast.loading(`Preparing ${format.toUpperCase()} export...`);

  const chunks: Uint8Array[] = [];
  try {
    const stream = auditApi.exportEvents({
      filter: {
        organizationId,
        actorUserId: filter.actorUserId ?? undefined,
        actions: filter.actions,
        resourceType: filter.resourceType ?? undefined,
        resourceId: filter.resourceId ?? undefined,
        fromTime: fromTime ? timestampFromDate(fromTime) : undefined,
        toTime: toTime ? timestampFromDate(toTime) : undefined,
        pageSize: 0,
      },
      format: format === "csv" ? EXPORT_FORMAT_CSV : EXPORT_FORMAT_JSON,
    });
    for await (const chunk of stream) {
      if (chunk.payload && chunk.payload.length > 0) {
        chunks.push(chunk.payload);
      }
    }
  } catch (error) {
    toast.dismiss(progress);
    const message = error instanceof Error ? error.message : "Export failed";
    const friendly = friendlyErrorMessage(message);
    if (friendly) toast.error(friendly);
    throw error;
  }

  const blob = new Blob(chunks as BlobPart[], {
    type: format === "csv" ? "text/csv;charset=utf-8" : "application/x-ndjson",
  });
  downloadBlob(blob, filename);
  toast.dismiss(progress);
  toast.success(`Downloaded ${filename} (${formatFileSize(blob.size)})`);
}

function buildFilename(orgSlug: string, format: "csv" | "json"): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const extension = format === "csv" ? "csv" : "json";
  return `uniffy-audit-${orgSlug}-${stamp}.${extension}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
