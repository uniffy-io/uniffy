import { File as FileIcon, X } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import { formatFileSize } from '@/shared/utils/dateFormatting';

interface PendingFile {
  id: string;
  name: string;
  size: number;
  progress?: number;
}

interface AttachmentPreviewBarProps {
  files: PendingFile[];
  onRemove: (id: string) => void;
}

export function AttachmentPreviewBar({ files, onRemove }: AttachmentPreviewBarProps) {
  if (files.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-1.5 px-4 py-2 border-t border-border/50 bg-muted/20"
      data-testid="chat-compose-attachments"
    >
      {files.map((file) => (
        <div
          key={file.id}
          className={cn(
            'relative flex items-center gap-1.5 px-2 py-1 rounded-lg',
            'bg-muted border border-border/50 text-sm max-w-[200px]',
          )}
          data-testid={`chat-compose-attachment-${file.id}`}
          data-progress={file.progress ?? -1}
        >
          <FileIcon size={14} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-foreground text-xs">{file.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            className="shrink-0 p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-colors"
            data-testid={`chat-compose-attachment-remove-${file.id}`}
          >
            <X size={12} />
          </button>
          {file.progress !== undefined && file.progress < 100 && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-lg overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${file.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
