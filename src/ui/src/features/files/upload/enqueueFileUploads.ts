import type { AppDispatch } from '@/app/store';
import { uploadService } from '@/features/files/upload/uploadService';
import { setFile } from '@/features/files/store/filesSlice';
import { fileToPlain } from '@/features/files/store/filesThunks';
import { bulkUpsertTags, tagToPlain } from '@/features/tags';
import type { UploadInput, UploadHandle } from '@/features/files/upload/uploadTypes';

/** Enqueue files/editor uploads and project each completed File row into the files store. */
export function enqueueFileUploads(inputs: UploadInput[], dispatch: AppDispatch): UploadHandle[] {
    const handles = uploadService.enqueue(inputs);
    for (const handle of handles) {
        handle.done
            .then(({ file }) => {
                if (file.tags.length > 0) {
                    dispatch(bulkUpsertTags(file.tags.map(tagToPlain)));
                }
                dispatch(setFile(fileToPlain(file)));
            })
            .catch(() => {
                // A failure shows in the tray and toasts centrally; there is nothing to project.
            });
    }
    return handles;
}
