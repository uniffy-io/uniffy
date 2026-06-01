import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/config';
import { uploadService } from '@/features/files/upload/uploadService';

const toasted = new Set<string>();

/**
 * Toasts each non-chat upload failure once, even while the tray is hidden - so a sticky-hidden tray
 * never lets a failure pass unnoticed. Chat shows its own inline error; cancellations are not failures.
 */
export function subscribeUploadErrorToasts(): () => void {
    return uploadService.subscribe((records) => {
        for (const record of records) {
            if (record.context === 'chat') continue;
            if (record.status !== 'failed') continue;
            if (toasted.has(record.id)) continue;
            toasted.add(record.id);
            toast.error(friendlyErrorMessage(record.error ?? '') ?? `Couldn't upload ${record.filename}`);
        }
    });
}
