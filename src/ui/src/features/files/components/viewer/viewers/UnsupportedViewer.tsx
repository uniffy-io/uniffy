import { DownloadSimple } from "@phosphor-icons/react";
import { useMediaUrl } from "@/features/files/components/viewer/hooks/useMedia";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import { formatFileSize } from "@/features/files/components/list/utils";
import { renderFileIcon } from "@/features/files/components/list/utils";

interface UnsupportedViewerProps {
  file: SerializedFile;
}

export function UnsupportedViewer({ file }: UnsupportedViewerProps) {
  const streamUrl = useMediaUrl(file.id);

  const handleDownload = () => {
    if (!streamUrl) return;

    const link = document.createElement("a");
    link.href = streamUrl;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="viewer-unsupported">
        {/* File icon */}
        <div className="mb-6 flex justify-center viewer-unsupported-icon">
          {renderFileIcon(file.mimeType, 64, "text-muted-foreground")}
        </div>

        {/* File name */}
        <h2 className="viewer-unsupported-title">{file.filename}</h2>

        {/* File info */}
        <div className="viewer-unsupported-meta">
          <p>{formatFileSize(file.sizeBytes)}</p>
          <p>{file.mimeType}</p>
        </div>

        {/* Message */}
        <p className="viewer-unsupported-message">
          This file type cannot be previewed in the browser.
        </p>

        {/* Download button */}
        <button
          onClick={handleDownload}
          className="viewer-btn-primary inline-flex items-center gap-2 px-6 py-3 font-medium"
        >
          <DownloadSimple size={20} weight="bold" />
          Download File
        </button>
      </div>
    </div>
  );
}
