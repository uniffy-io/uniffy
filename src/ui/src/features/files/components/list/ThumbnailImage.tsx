import { useState } from "react";
import { useThumbnailUrl } from "@/features/files/hooks/useThumbnail";
import type { SerializedFile } from "@/features/files/store/filesThunks";

interface ThumbnailImageProps {
  file: SerializedFile;
  fallback: React.ReactNode;
}

export function ThumbnailImage({ file, fallback }: ThumbnailImageProps) {
  // A failed load is remembered per version, so new bytes retry on their own.
  const [failedVersion, setFailedVersion] = useState<number | null>(null);
  const { url } = useThumbnailUrl(file.id);

  // `hasThumbnail` flips through the FILE_UPDATED refetch once the worker has
  // stored the JPEG, so the request is never made before the object exists.
  const hasThumbnail = file.metadata?.hasThumbnail ?? false;
  if (!hasThumbnail || !url || failedVersion === file.version) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={`${url}?v=${file.version}`}
      alt={file.filename}
      className="w-full h-full object-cover"
      loading="lazy"
      onError={() => setFailedVersion(file.version)}
    />
  );
}
