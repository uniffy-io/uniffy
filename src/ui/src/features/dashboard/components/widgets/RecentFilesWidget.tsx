/**
 * RecentFilesWidget - Shows recently uploaded/accessed files
 *
 * Displays last 5 files with thumbnail (if image), filename, size, and date.
 * Uses useThumbnailUrl for authenticated image previews.
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderSimple, ArrowRight } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { cn } from '@/shared/utils/cn';
import { WidgetCard, EmptyWidget, WidgetSkeleton } from '@/features/dashboard/components/widgets/WidgetCard';
import { formatRelativeTime, formatFileSize } from '@/shared/utils/dateFormatting';
import { useThumbnailUrl } from '@/features/files/hooks/useThumbnail';

function timestampToIso(ts: { seconds: number; nanos: number } | undefined): string {
  if (!ts) return new Date(0).toISOString();
  return new Date(ts.seconds * 1000).toISOString();
}

function FileThumbnail({ fileId, hasThumbnail }: { fileId: string; hasThumbnail: boolean }) {
  const { url } = useThumbnailUrl(hasThumbnail ? fileId : null);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="w-8 h-8 rounded-md object-cover bg-muted"
      />
    );
  }

  return (
    <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center">
      <FolderSimple size={16} weight="duotone" className="text-blue-600 dark:text-blue-400" />
    </div>
  );
}

export function RecentFilesWidget() {
  const navigate = useNavigate();
  const files = useAppSelector((state) => state.files?.files ?? {});
  const isLoading = useAppSelector((state) => state.files?.loading ?? false);

  const recentFiles = useMemo(() => {
    return Object.values(files)
      .filter((f) => !f.isDeleted)
      .sort((a, b) => {
        const aTime = a.updatedAt?.seconds ?? 0;
        const bTime = b.updatedAt?.seconds ?? 0;
        return bTime - aTime;
      })
      .slice(0, 5);
  }, [files]);

  const isEmpty = recentFiles.length === 0 && !isLoading;

  return (
    <WidgetCard
      title="Recent Files"
      icon={FolderSimple}
      colSpan={2}
      priority={2}
      footer={
        recentFiles.length > 0 ? (
          <Link
            to="/files"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all files
            <ArrowRight size={12} />
          </Link>
        ) : null
      }
    >
      {isLoading && Object.keys(files).length === 0 ? (
        <WidgetSkeleton rows={4} />
      ) : isEmpty ? (
        <EmptyWidget
          icon={FolderSimple}
          title="No files yet"
          description="Upload files to get started"
          action={{
            label: 'Upload a file',
            onClick: () => navigate('/files?upload=true'),
          }}
        />
      ) : (
        <div className="space-y-0.5">
          {recentFiles.map((file) => (
            <Link
              key={file.id}
              to={`/files?file=${file.id}`}
              className={cn(
                'group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors',
                'hover:bg-muted/50',
              )}
            >
              <FileThumbnail
                fileId={file.id}
                hasThumbnail={file.metadata?.hasThumbnail ?? false}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                  {file.filename}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.sizeBytes ?? 0)}
                </p>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {formatRelativeTime(timestampToIso(file.updatedAt))}
              </span>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
