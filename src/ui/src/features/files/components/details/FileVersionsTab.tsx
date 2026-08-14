import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClockCounterClockwise, DownloadSimple } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  fetchFile,
  fetchFileVersions,
  restoreFileVersion,
} from "@/features/files/store/filesThunks";
import type { SerializedFile, SerializedFileVersion } from "@/features/files/store/filesThunks";
import { fetchFileBlob } from "@/features/files/components/viewer/hooks/useFileDownload";
import { formatFileSize } from "@/features/files/components/list/utils";
import { formatProtoDateTime } from "@/shared/utils/dateFormatting";
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface FileVersionsTabProps {
  file: SerializedFile;
}

export function FileVersionsTab({ file }: FileVersionsTabProps) {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const currentUserId = useAppSelector((state) => state.auth.user?.id);
  const versions = useAppSelector((state) => state.files.fileVersions[file.id]);
  const loading = useAppSelector((state) => state.files.fileVersionsLoading);

  const [confirmVersion, setConfirmVersion] = useState<SerializedFileVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // List-loaded files carry no userRole; the owner check covers them until
  // the fetchFile hydration below fills the role in.
  const canRestore = roleCanEdit(file.userRole) || file.ownerId === currentUserId;

  // Hydrate userRole (GetFile resolves it; list responses do not).
  useEffect(() => {
    void dispatch(fetchFile(file.id));
  }, [dispatch, file.id]);

  // file.version in the deps keeps the list live: every version-creating
  // write upserts the file into the store, which bumps version here.
  useEffect(() => {
    void dispatch(fetchFileVersions(file.id));
  }, [dispatch, file.id, file.version]);

  const handleDownload = async (version: SerializedFileVersion) => {
    if (!organizationId || downloadingId) return;
    setDownloadingId(version.id);
    try {
      const result = await fetchFileBlob(file.id, organizationId, {
        versionId: version.id,
      });
      if (!result) return;
      const a = document.createElement("a");
      a.href = result.url;
      a.download = result.filename || file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleRestore = async () => {
    if (!confirmVersion || restoring) return;
    setRestoring(true);
    try {
      await dispatch(
        restoreFileVersion({ fileId: file.id, versionId: confirmVersion.id }),
      ).unwrap();
      toast.success(`Restored version ${confirmVersion.versionNumber}`);
      setConfirmVersion(null);
    } catch {
      // The global error toast pipeline surfaces rejected thunks.
    } finally {
      setRestoring(false);
    }
  };

  if (loading && !versions) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">Loading versions...</div>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <div className="text-center py-8">
        <ClockCounterClockwise
          size={32}
          weight="duotone"
          className="mx-auto text-muted-foreground/50 mb-3"
        />
        <p className="text-sm text-muted-foreground">No version history</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Restoring an old version copies it forward as a new version; nothing in the history is
        overwritten.
      </p>
      <div className="space-y-2">
        {versions.map((version) => {
          const isCurrent = version.versionNumber === file.version;
          return (
            <div key={version.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Version {version.versionNumber}</span>
                  {isCurrent && (
                    <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Current
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatFileSize(version.sizeBytes)} &middot;{" "}
                  {formatProtoDateTime(version.createdAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDownload(version)}
                disabled={downloadingId !== null}
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title="Download this version"
                aria-label={`Download version ${version.versionNumber}`}
              >
                <DownloadSimple size={16} weight="bold" />
              </button>
              {canRestore && !isCurrent && (
                <button
                  type="button"
                  onClick={() => setConfirmVersion(version)}
                  disabled={restoring}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  title="Restore this version"
                  aria-label={`Restore version ${version.versionNumber}`}
                >
                  <ClockCounterClockwise size={16} weight="bold" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={confirmVersion !== null}
        onClose={() => setConfirmVersion(null)}
        onConfirm={() => void handleRestore()}
        title="Restore version"
        message={
          confirmVersion
            ? `Restore version ${confirmVersion.versionNumber} of "${file.filename}"? It becomes the new current version; the existing history is kept.`
            : ""
        }
        confirmLabel="Restore"
        variant="default"
        loading={restoring}
      />
    </div>
  );
}
