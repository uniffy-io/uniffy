import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { Info } from '@phosphor-icons/react';
import type { PdfDocumentInfo } from '@/features/files/store/viewerSlice';
import { buildPdfInfoRows } from '@/features/files/components/viewer/pdf/pdfMetadata';

interface PdfInfoPopoverProps {
    info: PdfDocumentInfo | null;
    numPages: number;
    sizeBytes: number;
}

export function PdfInfoPopover({ info, numPages, sizeBytes }: PdfInfoPopoverProps) {
    const rows = buildPdfInfoRows(info, numPages, sizeBytes);

    return (
        <Popover className="relative">
            <PopoverButton className="viewer-btn p-2" title="Document info">
                <Info size={20} />
            </PopoverButton>
            <PopoverPanel anchor="bottom end" className="viewer-pdf-info-panel z-50">
                {rows.length === 0 ? (
                    <p className="viewer-pdf-info-empty">No document information</p>
                ) : (
                    <dl className="viewer-pdf-info-rows">
                        {rows.map((row) => (
                            <div key={row.label} className="viewer-pdf-info-row">
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </PopoverPanel>
        </Popover>
    );
}
