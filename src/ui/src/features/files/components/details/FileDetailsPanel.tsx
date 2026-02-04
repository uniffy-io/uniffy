/**
 * File Details Panel
 *
 * Right-side panel showing file information, metadata, and EXIF data.
 * Follows the same pattern as NotesMetadataPanel.
 */

import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { setDetailsPanelTab } from '@/features/files/store/filesSlice';
import type { DetailsPanelTab } from '@/features/files/store/filesSlice';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import { formatFileSize } from '@/features/files/components/list/utils';
import { ThumbnailImage } from '@/features/files/components/list/ThumbnailImage';
import {
    useContentPermissions,
    getPermissionLevelLabel,
    isUserPermission,
    isGroupPermission,
} from '@/features/sharing';
import { ContentType, VisibilityScope } from '@/gen/common/v1/common_pb';
import {
    Info,
    Camera,
    Lock,
    Globe,
    Users,
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
    CircleNotch,
} from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface FileDetailsPanelProps {
    file: SerializedFile | null;
}

/** Get visibility label and icon */
function getVisibilityInfo(visibility: VisibilityScope) {
    switch (visibility) {
        case VisibilityScope.PRIVATE:
            return { label: 'Private', icon: Lock, className: 'text-muted-foreground' };
        case VisibilityScope.GROUP:
            return { label: 'Shared with groups', icon: Users, className: 'text-blue-500' };
        case VisibilityScope.ORGANIZATION:
            return { label: 'Organization', icon: Globe, className: 'text-green-500' };
        default:
            return { label: 'Unknown', icon: Lock, className: 'text-muted-foreground' };
    }
}

/** Format date for display */
function formatDateTime(timestamp?: { seconds: number; nanos: number }): string {
    if (!timestamp) return '-';
    const date = new Date(timestamp.seconds * 1000);
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** Format duration in seconds to readable format */
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/** Get initials from a name */
function getInitials(name: string): string {
    return name
        .split(' ')
        .map(part => part[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

/** Map common EXIF tag names to readable labels */
const EXIF_LABELS: Record<string, string> = {
    Make: 'Camera Make',
    Model: 'Camera Model',
    DateTime: 'Date Taken',
    DateTimeOriginal: 'Date Taken',
    ExposureTime: 'Shutter Speed',
    FNumber: 'Aperture',
    ISO: 'ISO',
    ISOSpeedRatings: 'ISO',
    FocalLength: 'Focal Length',
    FocalLengthIn35mmFilm: 'Focal Length (35mm)',
    Flash: 'Flash',
    WhiteBalance: 'White Balance',
    ExposureProgram: 'Exposure Program',
    MeteringMode: 'Metering Mode',
    GPSLatitude: 'GPS Latitude',
    GPSLongitude: 'GPS Longitude',
    GPSAltitude: 'GPS Altitude',
    Software: 'Software',
    Artist: 'Artist',
    Copyright: 'Copyright',
    ImageDescription: 'Description',
    Orientation: 'Orientation',
    XResolution: 'X Resolution',
    YResolution: 'Y Resolution',
    ResolutionUnit: 'Resolution Unit',
    ColorSpace: 'Color Space',
    LensModel: 'Lens Model',
    LensMake: 'Lens Make',
};

/** Get icon for EXIF field */
function getExifIcon(key: string) {
    if (key.includes('GPS')) return MapPin;
    if (key.includes('Aperture') || key.includes('FNumber')) return Aperture;
    if (key.includes('Exposure') || key.includes('Shutter')) return Timer;
    if (key.includes('Camera') || key.includes('Make') || key.includes('Model')) return Camera;
    return null;
}

export function FileDetailsPanel({ file }: FileDetailsPanelProps) {
    const dispatch = useAppDispatch();
    const detailsPanelTab = useAppSelector((state) => state.files.detailsPanelTab);
    const currentUser = useAppSelector((state) => state.auth.user);

    // Fetch permissions for the file (only when file exists)
    const {
        permissions,
        loading: permissionsLoading,
    } = useContentPermissions(ContentType.FILE, file?.id ?? '');

    if (!file) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-4">
                <Info size={32} weight="duotone" className="mb-2 opacity-50" />
                <p className="text-sm">Select a file to view details</p>
            </div>
        );
    }

    // Filter permissions to get users and groups
    const userPermissions = permissions.filter(isUserPermission);
    const groupPermissions = permissions.filter(isGroupPermission);

    const isOwner = currentUser && file.ownerId === currentUser.id;
    const ownerName = file.ownerInfo?.name || (isOwner ? (currentUser.fullName || currentUser.username || 'You') : 'Unknown');
    const ownerInitials = getInitials(ownerName);
    const visibilityInfo = getVisibilityInfo(file.visibility);
    const VisibilityIcon = visibilityInfo.icon;

    const tabs: Array<{ id: DetailsPanelTab; label: string; icon: typeof Info }> = [
        { id: 'info', label: 'Info', icon: Info },
        { id: 'metadata', label: 'Metadata', icon: Camera },
        { id: 'permissions', label: 'Access', icon: Lock },
    ];

    // Determine file type for metadata display
    const isImage = file.mimeType.startsWith('image/');
    const isVideo = file.mimeType.startsWith('video/');
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
                                <FileIcon size={48} weight="duotone" className="text-muted-foreground/50" />
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
                        <span className="text-sm">{metadata.width} x {metadata.height} px</span>
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
                        <span className="text-sm">{formatDuration(metadata.durationSeconds)}</span>
                    </div>
                </div>
            )}

            {/* Page count (for PDFs) */}
            {metadata?.pageCount && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Pages</label>
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                        <FilePdf size={16} weight="duotone" className="text-muted-foreground" />
                        <span className="text-sm">{metadata.pageCount} page{metadata.pageCount !== 1 ? 's' : ''}</span>
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
                    <span className="text-sm">{formatDateTime(file.createdAt)}</span>
                </div>
            </div>

            {/* Modified */}
            <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Modified</label>
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                    <Calendar size={16} weight="duotone" className="text-muted-foreground" />
                    <span className="text-sm">{formatDateTime(file.updatedAt)}</span>
                </div>
            </div>

            {/* Tags */}
            {file.tags && file.tags.length > 0 && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-2">Tags</label>
                    <div className="flex flex-wrap gap-2">
                        {file.tags.map((tag: string) => (
                            <span
                                key={tag}
                                className="px-2 py-1 text-xs rounded-md bg-muted text-muted-foreground"
                            >
                                #{tag}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Description */}
            {file.description && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
                    <p className="text-sm p-2 rounded-md bg-muted/50 whitespace-pre-wrap">{file.description}</p>
                </div>
            )}
        </div>
    );

    const renderMetadataTab = () => {
        const exif = metadata?.exif;
        const hasExif = exif && Object.keys(exif).length > 0;

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
                            EXIF Data
                        </h4>
                        <div className="space-y-1">
                            {Object.entries(exif).map(([key, value]) => {
                                const label = EXIF_LABELS[key] || key;
                                const Icon = getExifIcon(key);
                                return (
                                    <div
                                        key={key}
                                        className="flex justify-between items-start gap-2 p-2 rounded-md bg-muted/50"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            {Icon && <Icon size={14} weight="duotone" className="text-muted-foreground shrink-0" />}
                                            <span className="text-sm text-muted-foreground truncate">{label}</span>
                                        </div>
                                        <span className="text-sm font-medium text-right break-all max-w-[50%]">
                                            {value}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-8">
                        <Camera size={32} weight="duotone" className="mx-auto text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">No EXIF data available</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {isImage
                                ? 'This image does not contain EXIF metadata'
                                : 'EXIF data is only available for images'}
                        </p>
                    </div>
                )}

                {/* Processing error */}
                {metadata?.error && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                        <p className="text-sm text-red-500">{metadata.error}</p>
                    </div>
                )}
            </div>
        );
    };

    const renderPermissionsTab = () => (
        <div className="space-y-4">
            {/* Visibility */}
            <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Visibility</label>
                <div className={cn('flex items-center gap-2 p-2 rounded-md bg-muted/50', visibilityInfo.className)}>
                    <VisibilityIcon size={16} weight="duotone" />
                    <span className="text-sm">{visibilityInfo.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                    {file.visibility === VisibilityScope.PRIVATE && 'Only you can access this file'}
                    {file.visibility === VisibilityScope.GROUP && 'Shared with specific groups'}
                    {file.visibility === VisibilityScope.ORGANIZATION && 'Everyone in your organization can access'}
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

            {/* Shared with users */}
            {permissionsLoading ? (
                <div className="flex items-center justify-center py-4">
                    <CircleNotch size={20} weight="bold" className="animate-spin text-muted-foreground" />
                </div>
            ) : userPermissions.length > 0 && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-2">
                        Shared with ({userPermissions.length})
                    </label>
                    <div className="space-y-2">
                        {userPermissions.map((perm) => {
                            const subject = perm.subject;
                            if (!subject) return null;
                            const initials = getInitials(subject.name || subject.email || 'U');
                            const isCurrentUser = currentUser && subject.id === currentUser.id;
                            return (
                                <div
                                    key={perm.id}
                                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-xs text-white font-medium shrink-0">
                                            {initials}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm truncate">
                                                {subject.name || subject.email}
                                                {isCurrentUser && <span className="text-muted-foreground ml-1">(you)</span>}
                                            </p>
                                            {subject.email && subject.name && (
                                                <p className="text-xs text-muted-foreground truncate">{subject.email}</p>
                                            )}
                                        </div>
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                                        {getPermissionLevelLabel(perm.level)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Shared with groups */}
            {!permissionsLoading && groupPermissions.length > 0 && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-2">
                        Groups ({groupPermissions.length})
                    </label>
                    <div className="space-y-2">
                        {groupPermissions.map((perm) => {
                            const subject = perm.subject;
                            if (!subject) return null;
                            return (
                                <div
                                    key={perm.id}
                                    className="flex items-center justify-between p-2 rounded-md bg-muted/50"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className="w-6 h-6 rounded-md bg-blue-500 flex items-center justify-center shrink-0">
                                            <Users size={14} weight="bold" className="text-white" />
                                        </div>
                                        <p className="text-sm truncate">{subject.name}</p>
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0 ml-2">
                                        {getPermissionLevelLabel(perm.level)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* No sharing info */}
            {!permissionsLoading && userPermissions.length === 0 && groupPermissions.length === 0 && (
                <div className="text-center py-4">
                    <p className="text-sm text-muted-foreground">Not shared with anyone</p>
                </div>
            )}
        </div>
    );

    const renderContent = () => {
        switch (detailsPanelTab) {
            case 'info':
                return renderInfoTab();
            case 'metadata':
                return renderMetadataTab();
            case 'permissions':
                return renderPermissionsTab();
            default:
                return renderInfoTab();
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
                {tabs.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => dispatch(setDetailsPanelTab(id))}
                        className={cn(
                            'flex-1 flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors relative',
                            detailsPanelTab === id
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground'
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
            <div className="flex-1 overflow-y-auto p-4">
                {renderContent()}
            </div>
        </div>
    );
}
