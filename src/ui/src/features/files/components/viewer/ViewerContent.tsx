import { lazy, Suspense } from 'react';
import { Spinner } from '@phosphor-icons/react';
import type { SerializedFile } from '@/features/files/store/filesThunks';

// Lazy load to keep the initial bundle small.
const ImageViewer = lazy(() =>
    import('./viewers/ImageViewer').then((m) => ({ default: m.ImageViewer }))
);
const ImageEditor = lazy(() =>
    import('./editor/ImageEditor').then((m) => ({ default: m.ImageEditor }))
);
const VideoViewer = lazy(() =>
    import('./viewers/VideoViewer').then((m) => ({ default: m.VideoViewer }))
);
const AudioViewer = lazy(() =>
    import('./viewers/AudioViewer').then((m) => ({ default: m.AudioViewer }))
);
const PdfViewer = lazy(() =>
    import('./viewers/PdfViewer').then((m) => ({ default: m.PdfViewer }))
);
const TextViewer = lazy(() =>
    import('./viewers/TextViewer').then((m) => ({ default: m.TextViewer }))
);
const UnsupportedViewer = lazy(() =>
    import('./viewers/UnsupportedViewer').then((m) => ({ default: m.UnsupportedViewer }))
);

interface ViewerContentProps {
    file: SerializedFile;
    isEditing?: boolean;
    initialRotation?: number;
    onExitEdit?: () => void;
}

function isCodeFile(mimeType: string): boolean {
    const codeTypes = [
        'application/javascript',
        'application/typescript',
        'application/json',
        'application/xml',
        'application/x-yaml',
        'application/x-python',
        'application/x-ruby',
        'application/x-php',
        'application/x-sh',
        'application/x-shellscript',
    ];

    if (codeTypes.includes(mimeType)) {
        return true;
    }

    if (mimeType.startsWith('text/')) {
        return true;
    }

    return false;
}

function ViewerLoading() {
    return (
        <div className="viewer-loading">
            <Spinner size={48} className="animate-spin" />
        </div>
    );
}

export function ViewerContent({ file, isEditing, initialRotation, onExitEdit }: ViewerContentProps) {
    const { mimeType } = file;

    const getViewer = () => {
        // Image editing mode
        if (mimeType.startsWith('image/') && isEditing && onExitEdit) {
            return <ImageEditor file={file} initialRotation={initialRotation} onClose={onExitEdit} />;
        }

        // Images
        if (mimeType.startsWith('image/')) {
            return <ImageViewer file={file} />;
        }

        // Videos
        if (mimeType.startsWith('video/')) {
            return <VideoViewer file={file} />;
        }

        // Audio
        if (mimeType.startsWith('audio/')) {
            return <AudioViewer file={file} />;
        }

        // PDFs
        if (mimeType === 'application/pdf') {
            return <PdfViewer file={file} />;
        }

        // Text and code files
        if (isCodeFile(mimeType)) {
            return <TextViewer file={file} />;
        }

        // Unsupported - show download option
        return <UnsupportedViewer file={file} />;
    };

    return (
        <div className="w-full h-full">
            <Suspense fallback={<ViewerLoading />}>{getViewer()}</Suspense>
        </div>
    );
}
