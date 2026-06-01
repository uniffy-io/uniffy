import type { AppDispatch } from '@/app/store';
import { uploadService } from '@/features/files/upload/uploadService';
import { setUploadRecords } from '@/features/files/store/uploadSlice';

/**
 * Mirrors the engine's non-chat uploads into Redux for the global tray. Takes `dispatch` rather than
 * importing the store so the service stays store-free and no import cycle forms. Chat stays off Redux.
 */
export function subscribeUploadMirror(dispatch: AppDispatch): () => void {
    return uploadService.subscribe((records) => {
        dispatch(setUploadRecords(records.filter((record) => record.context !== 'chat')));
    });
}
