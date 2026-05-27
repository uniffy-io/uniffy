import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Spinner } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setTotalPages, setViewerLoading } from '@/features/files/store/viewerSlice';
import { useFileDownload } from '@/features/files/components/viewer/hooks/useFileDownload';
import type { SerializedFile } from '@/features/files/store/filesThunks';

import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
    file: SerializedFile;
}

export function PdfViewer({ file }: PdfViewerProps) {
    const dispatch = useAppDispatch();
    const currentPage = useAppSelector((state) => state.fileViewer.currentPage);
    const pdfZoom = useAppSelector((state) => state.fileViewer.pdfZoom);
    const { url: pdfUrl, loading: downloadLoading, error: downloadError } = useFileDownload(file.id);

    const [error, setError] = useState<string | null>(null);

    const handleDocumentLoadSuccess = useCallback(
        ({ numPages }: { numPages: number }) => {
            dispatch(setTotalPages(numPages));
            dispatch(setViewerLoading(false));
        },
        [dispatch]
    );

    const handleDocumentLoadError = useCallback(
        () => {
            setError('Failed to load PDF');
            dispatch(setViewerLoading(false));
        },
        [dispatch]
    );

    if (downloadLoading) {
        return (
            <div className="viewer-loading">
                <Spinner size={48} className="animate-spin" />
            </div>
        );
    }

    if (downloadError || !pdfUrl) {
        return (
            <div className="viewer-error">
                <p>{downloadError || 'Unable to load PDF'}</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="viewer-error">
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="viewer-pdf-content">
            <Document
                file={pdfUrl}
                onLoadSuccess={handleDocumentLoadSuccess}
                onLoadError={handleDocumentLoadError}
                loading={
                    <div className="flex items-center justify-center p-8">
                        <Spinner size={32} className="animate-spin text-slate-400" />
                    </div>
                }
            >
                <Page
                    pageNumber={currentPage}
                    scale={pdfZoom}
                    className="shadow-2xl rounded-sm"
                    loading={
                        <div className="flex items-center justify-center p-8 min-h-[400px]">
                            <Spinner size={32} className="animate-spin text-slate-400" />
                        </div>
                    }
                />
            </Document>
        </div>
    );
}
