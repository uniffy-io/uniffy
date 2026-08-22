import { useState, useRef, useCallback } from "react";
import { Camera, Trash, SpinnerGap } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ACCEPT = ALLOWED_TYPES.join(",");

type AvatarSize = "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  md: "w-16 h-16",
  lg: "w-20 h-20",
};

const SPINNER_SIZES: Record<AvatarSize, number> = {
  md: 20,
  lg: 24,
};

interface AvatarUploadProps {
  imageUrl?: string;
  /** Fallback content when no image (initials, emoji, icon). */
  fallback?: React.ReactNode;
  size?: AvatarSize;
  onUpload: (file: File) => Promise<void>;
  /** Omit to hide the remove button. */
  onDelete?: () => Promise<void>;
  disabled?: boolean;
}

export function AvatarUpload({
  imageUrl,
  fallback,
  size = "lg",
  onUpload,
  onDelete,
  disabled = false,
}: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isProcessing = uploading || deleting || disabled;
  const hasImage = !!imageUrl;

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      if (!ALLOWED_TYPES.includes(file.type)) {
        setError("Please select a JPEG, PNG, WebP, or GIF image.");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError("Image must be smaller than 5 MB.");
        return;
      }

      setError(null);
      setUploading(true);
      try {
        await onUpload(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to upload avatar";
        setError(msg);
      } finally {
        setUploading(false);
      }
    },
    [onUpload],
  );

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    setError(null);
    setDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove avatar";
      setError(msg);
    } finally {
      setDeleting(false);
    }
  }, [onDelete]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div className="relative group">
          <div
            className={cn(
              "rounded-full overflow-hidden flex items-center justify-center border-2 border-border",
              !hasImage && "bg-muted",
              SIZE_CLASSES[size],
            )}
          >
            {hasImage ? (
              <img src={imageUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-muted-foreground">{fallback}</span>
            )}
            {(uploading || deleting) && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-full">
                <SpinnerGap size={SPINNER_SIZES[size]} className="animate-spin text-foreground" />
              </div>
            )}
          </div>
          {!isProcessing && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-background/0 group-hover:bg-background/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Camera size={SPINNER_SIZES[size]} className="text-foreground" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
              <Camera size={14} weight="bold" />
              {hasImage ? "Change" : "Upload"}
            </Button>
            {hasImage && onDelete && (
              <Button variant="outline" size="sm" onClick={handleDelete} disabled={isProcessing}>
                <Trash size={14} weight="bold" />
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs font-medium text-muted-foreground">
            JPEG, PNG, WebP, or GIF. Max 5 MB.
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
}
