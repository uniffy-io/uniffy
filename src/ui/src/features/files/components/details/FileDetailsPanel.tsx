import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { setDetailsPanelTab, setDetailsPanelOpen } from "@/features/files/store/filesSlice";
import type { DetailsPanelTab } from "@/features/files/store/filesSlice";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import { formatFileSize } from "@/features/files/components/list/utils";
import { formatProtoDateTime, formatMediaTime } from "@/shared/utils/dateFormatting";
import { ThumbnailImage } from "@/features/files/components/list/ThumbnailImage";
import { useAccessPolicyDialog } from "@/features/permissions";
import {
  accessModeLabel,
  accessModeDescription,
  accessModeIcon,
  roleCanManage,
} from "@/shared/utils/contentRoles";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  Info,
  Camera,
  Calendar,
  HardDrive,
  ImageSquare,
  FilePdf,
  VideoCamera,
  MusicNote,
  MapPin,
  Aperture,
  Timer,
  File as FileIcon,
  Waveform,
  SpeakerHigh,
  Lock,
  ClockCounterClockwise,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/utils/cn";
import { getInitials } from "@/components/subject/utils";
import { TagChip } from "@/features/tags";
import { useTagsByIds } from "@/features/tags/store/selectors";
import { FileVersionsTab } from "@/features/files/components/details/FileVersionsTab";

interface FileDetailsPanelProps {
  file: SerializedFile | null;
}

/** Map common EXIF tag names to readable labels */
const EXIF_LABELS: Record<string, string> = {
  Make: "Camera Make",
  Model: "Camera Model",
  DateTime: "Date Taken",
  DateTimeOriginal: "Date Taken",
  DateTimeDigitized: "Date Digitized",
  ExposureTime: "Shutter Speed",
  FNumber: "Aperture",
  ISO: "ISO",
  ISOSpeedRatings: "ISO",
  FocalLength: "Focal Length",
  FocalLengthIn35mmFilm: "Focal Length (35mm)",
  Flash: "Flash",
  WhiteBalance: "White Balance",
  ExposureProgram: "Exposure Program",
  ExposureMode: "Exposure Mode",
  ExposureBiasValue: "Exposure Bias",
  MeteringMode: "Metering Mode",
  SceneCaptureType: "Scene Type",
  SubjectDistanceRange: "Subject Distance",
  GPSLatitude: "Latitude",
  GPSLongitude: "Longitude",
  GPSAltitude: "Altitude",
  GPSLatitudeRef: "Latitude Ref",
  GPSLongitudeRef: "Longitude Ref",
  Software: "Software",
  Artist: "Artist",
  Copyright: "Copyright",
  ImageDescription: "Description",
  Orientation: "Orientation",
  XResolution: "X Resolution",
  YResolution: "Y Resolution",
  ResolutionUnit: "Resolution Unit",
  ColorSpace: "Color Space",
  LensModel: "Lens Model",
  LensMake: "Lens Make",
  BrightnessValue: "Brightness",
  MaxApertureValue: "Max Aperture",
  DigitalZoomRatio: "Digital Zoom",
  ImageWidth: "Width",
  ImageLength: "Height",
  ShutterSpeedValue: "Shutter Speed",
  ApertureValue: "Aperture Value",
};

/** EXIF keys to hide (internal/redundant data) */
const EXIF_HIDDEN_KEYS = new Set([
  "MakerNote",
  "UserComment",
  "ComponentsConfiguration",
  "FlashPixVersion",
  "ExifVersion",
  "InteropOffset",
  "PrintImageMatching",
  "Padding",
]);

/** Get icon for EXIF field */
function getExifIcon(key: string) {
  if (key.startsWith("GPS")) return MapPin;
  if (key.includes("Aperture") || key.includes("FNumber")) return Aperture;
  if (key.includes("Exposure") || key.includes("Shutter")) return Timer;
  if (key.includes("Make") || key.includes("Model") || key.includes("Lens")) return Camera;
  return null;
}

/** Format EXIF value for display */
function formatExifValue(_key: string, value: string): string {
  if (!value && value !== "0") return "-";
  return String(value);
}

export function FileDetailsPanel({ file }: FileDetailsPanelProps) {
  const dispatch = useAppDispatch();
  const { isMobileOrTablet } = useBreakpoint();
  const detailsPanelTab = useAppSelector((state) => state.files.detailsPanelTab);
  const currentUser = useAppSelector((state) => state.auth.user);
  const fileTags = useTagsByIds(file?.tagIds ?? []);
  const { openFor: openAccessPolicy } = useAccessPolicyDialog();

  if (!file) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4">
        <Info size={32} weight="duotone" className="mb-2 opacity-50" />
        <p className="text-sm">Select a file to view details</p>
      </div>
    );
  }

  const isOwner = currentUser && file.ownerId === currentUser.id;
  const ownerName =
    file.ownerInfo?.name ||
    (isOwner ? currentUser.fullName || currentUser.username || "You" : "Unknown");
  const ownerInitials = getInitials(ownerName);
  const AccessModeIcon = accessModeIcon(file.accessMode);
  const canManage = roleCanManage(file.userRole);

  const tabs: Array<{ id: DetailsPanelTab; label: string; icon: typeof Info }> = [
    { id: "info", label: "Info", icon: Info },
    { id: "metadata", label: "Metadata", icon: Camera },
    { id: "permissions", label: "Access", icon: Lock },
    { id: "versions", label: "Versions", icon: ClockCounterClockwise },
  ];

  // Determine file type for metadata display
  const isImage = file.mimeType.startsWith("image/");
  const isVideo = file.mimeType.startsWith("video/");
  const isAudio = file.mimeType.startsWith("audio/");
  const metadata = file.metadata;

  const renderInfoTab = () => (
    <div className="space-y-4">
      {/* Thumbnail preview */}
      {metadata?.hasThumbnail && (
        <div className="relative aspect-video rounded-lg overflow-hidden bg-muted/30 border border-border">
          <ThumbnailImage
            file={file}
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <FileIcon size={48} weight="duotone" className="text-subtle-foreground" />
              </div>
            }
          />
        </div>
      )}

      {/* Filename */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Filename</label>
        <p className="text-sm p-2 rounded-md bg-muted/50 break-all">{file.filename}</p>
      </div>

      {/* File type */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Type</label>
        <p className="text-sm p-2 rounded-md bg-muted/50">{file.mimeType}</p>
      </div>

      {/* Size */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Size</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <HardDrive size={16} weight="duotone" className="text-muted-foreground" />
          <span className="text-sm">{formatFileSize(file.sizeBytes)}</span>
        </div>
      </div>

      {/* Dimensions (for images/videos) */}
      {metadata?.width && metadata?.height && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Dimensions</label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <ImageSquare size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-sm">
              {metadata.width} x {metadata.height} px
            </span>
          </div>
        </div>
      )}

      {/* Duration (for video/audio) */}
      {metadata?.durationSeconds && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Duration</label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            {isVideo ? (
              <VideoCamera size={16} weight="duotone" className="text-muted-foreground" />
            ) : (
              <MusicNote size={16} weight="duotone" className="text-muted-foreground" />
            )}
            <span className="text-sm">{formatMediaTime(metadata.durationSeconds)}</span>
          </div>
        </div>
      )}

      {/* Bitrate (for audio) */}
      {metadata?.bitrate != null && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Bitrate</label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <Waveform size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-sm">{Math.round(metadata.bitrate / 1000)} kbps</span>
          </div>
        </div>
      )}

      {/* Sample Rate (for audio) */}
      {metadata?.sampleRate != null && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Sample Rate
          </label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <Waveform size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-sm">{(metadata.sampleRate / 1000).toFixed(1)} kHz</span>
          </div>
        </div>
      )}

      {/* Channels (for audio) */}
      {metadata?.channels != null && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Channels</label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <SpeakerHigh size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-sm">
              {metadata.channels === 1
                ? "Mono"
                : metadata.channels === 2
                  ? "Stereo"
                  : `${metadata.channels} channels`}
            </span>
          </div>
        </div>
      )}

      {/* Page count (for PDFs) */}
      {metadata?.pageCount && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Pages</label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <FilePdf size={16} weight="duotone" className="text-muted-foreground" />
            <span className="text-sm">
              {metadata.pageCount} page{metadata.pageCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Owner */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Owner</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-medium">
            {ownerInitials}
          </div>
          <span className="text-sm">
            {ownerName}
            {isOwner && <span className="text-muted-foreground ml-1">(you)</span>}
          </span>
        </div>
      </div>

      {/* Created */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Created</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <Calendar size={16} weight="duotone" className="text-muted-foreground" />
          <span className="text-sm">{formatProtoDateTime(file.createdAt)}</span>
        </div>
      </div>

      {/* Modified */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Modified</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <Calendar size={16} weight="duotone" className="text-muted-foreground" />
          <span className="text-sm">{formatProtoDateTime(file.updatedAt)}</span>
        </div>
      </div>

      {/* Tags */}
      {fileTags.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-2">Tags</label>
          <div className="flex flex-wrap gap-2">
            {fileTags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {file.description && (
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Description
          </label>
          <p className="text-sm p-2 rounded-md bg-muted/50 whitespace-pre-wrap">
            {file.description}
          </p>
        </div>
      )}
    </div>
  );

  const renderMetadataTab = () => {
    const exif = metadata?.exif;
    const exifEntries = exif
      ? Object.entries(exif).filter(([key]) => !EXIF_HIDDEN_KEYS.has(key))
      : [];
    const hasExif = exifEntries.length > 0;

    return (
      <div className="space-y-4">
        {/* File format info */}
        {(metadata?.format || metadata?.colorMode) && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Format Details
            </h4>
            <div className="space-y-2">
              {metadata.format && (
                <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                  <span className="text-sm text-muted-foreground">Format</span>
                  <span className="text-sm font-medium">{metadata.format}</span>
                </div>
              )}
              {metadata.colorMode && (
                <div className="flex justify-between items-center p-2 rounded-md bg-muted/50">
                  <span className="text-sm text-muted-foreground">Color Mode</span>
                  <span className="text-sm font-medium">{metadata.colorMode}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EXIF data */}
        {hasExif ? (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              EXIF Data ({exifEntries.length})
            </h4>
            <div className="space-y-1">
              {exifEntries.map(([key, value]) => {
                const label = EXIF_LABELS[key] || key;
                const Icon = getExifIcon(key);
                const displayValue = formatExifValue(key, value);
                return (
                  <div
                    key={key}
                    className="flex justify-between items-start gap-2 p-2 rounded-md bg-muted/50"
                  >
                    <div className="flex items-center gap-2 min-w-0 shrink-0">
                      {Icon && (
                        <Icon
                          size={14}
                          weight="duotone"
                          className="text-muted-foreground shrink-0"
                        />
                      )}
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <span className="text-xs font-medium text-right break-all min-w-0">
                      {displayValue}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <Camera size={32} weight="duotone" className="mx-auto text-subtle-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No EXIF data available</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isImage
                ? "This image does not contain EXIF metadata"
                : isAudio
                  ? "Audio files do not contain EXIF metadata"
                  : "EXIF data is only available for images"}
            </p>
          </div>
        )}

        {/* Processing error */}
        {metadata?.error && (
          <div className="p-3 rounded-lg border status-error">
            <p className="text-sm" style={{ color: "var(--status-error)" }}>
              {metadata.error}
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderPermissionsTab = () => (
    <div className="space-y-4">
      {/* Access mode */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Access mode</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <AccessModeIcon size={16} weight="duotone" className="text-muted-foreground" />
          <span className="text-sm">{accessModeLabel(file.accessMode)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {accessModeDescription(file.accessMode)}
        </p>
      </div>

      {/* Owner */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">Owner</label>
        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground font-medium">
            {ownerInitials}
          </div>
          <span className="text-sm">
            {ownerName}
            {isOwner && <span className="text-muted-foreground ml-1">(you)</span>}
          </span>
        </div>
      </div>

      {/* Manage access button */}
      {canManage && (
        <Button
          variant="outline"
          size="md"
          className="w-full"
          onClick={() => openAccessPolicy(ContentType.FILE, file.id, file.filename, file.userRole)}
        >
          Manage access
        </Button>
      )}
    </div>
  );

  const renderContent = () => {
    switch (detailsPanelTab) {
      case "info":
        return renderInfoTab();
      case "metadata":
        return renderMetadataTab();
      case "permissions":
        return renderPermissionsTab();
      case "versions":
        return <FileVersionsTab file={file} />;
      default:
        return renderInfoTab();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-border-strong shrink-0">
        {isMobileOrTablet && (
          <button
            onClick={() => dispatch(setDetailsPanelOpen(false))}
            className="flex items-center justify-center px-2 py-3 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Close panel"
          >
            <X size={16} weight="bold" />
          </button>
        )}
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => dispatch(setDetailsPanelTab(id))}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors relative",
              detailsPanelTab === id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={16} weight="duotone" />
            <span className="hidden xl:inline">{label}</span>
            {detailsPanelTab === id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">{renderContent()}</div>
    </div>
  );
}
