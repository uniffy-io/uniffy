import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import { filesApi } from '@/features/files/api/filesApi';
import { fileToPlain, type SerializedFile } from '@/features/files/store/filesThunks';
import type { SerializedFolder } from '@/features/files/store/filesTreeThunks';

const folderToPlain = (folder: {
    id: string;
    name: string;
    parentId?: string;
    accessMode: number;
    ownerId: string;
    isDeleted: boolean;
}): SerializedFolder => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    accessMode: folder.accessMode,
    ownerId: folder.ownerId,
    isDeleted: folder.isDeleted,
});

export interface TrashState {
    files: SerializedFile[];
    folders: SerializedFolder[];
    loading: boolean;
    error: string | null;
    /** Set when the user has drilled into a trashed folder. */
    currentFolderId: string | null;
}

const initialState: TrashState = {
    files: [],
    folders: [],
    loading: false,
    error: null,
    currentFolderId: null,
};

export const fetchTrash = createAsyncThunk<
    { files: SerializedFile[]; folders: SerializedFolder[] },
    void,
    { state: RootState; rejectValue: string }
>('trash/fetch', async (_, { getState, rejectWithValue }) => {
    const organizationId = getState().auth.currentOrganizationId;
    if (!organizationId) {
        return rejectWithValue('No organization selected');
    }
    try {
        const response = await filesApi.listTrash({ organizationId });
        return {
            files: response.files.map(fileToPlain),
            folders: response.folders.map((f) =>
                folderToPlain({
                    id: f.id,
                    name: f.name,
                    parentId: f.parentId,
                    accessMode: f.accessMode,
                    ownerId: f.ownerId,
                    isDeleted: f.isDeleted,
                }),
            ),
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to load trash',
        );
    }
});

const trashSlice = createSlice({
    name: 'trash',
    initialState,
    reducers: {
        setTrashFolderId: (state, action: PayloadAction<string | null>) => {
            state.currentFolderId = action.payload;
        },
        removeTrashFile: (state, action: PayloadAction<string>) => {
            state.files = state.files.filter((f) => f.id !== action.payload);
        },
        removeTrashFolder: (state, action: PayloadAction<string>) => {
            const removed = new Set<string>([action.payload]);
            // Cascade through descendant folders and their files.
            let changed = true;
            while (changed) {
                changed = false;
                for (const folder of state.folders) {
                    if (folder.parentId && removed.has(folder.parentId) && !removed.has(folder.id)) {
                        removed.add(folder.id);
                        changed = true;
                    }
                }
            }
            state.folders = state.folders.filter((f) => !removed.has(f.id));
            state.files = state.files.filter(
                (f) => !f.folderId || !removed.has(f.folderId),
            );
        },
        clearTrash: (state) => {
            state.files = [];
            state.folders = [];
            state.currentFolderId = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchTrash.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchTrash.fulfilled, (state, action) => {
                state.loading = false;
                state.files = action.payload.files;
                state.folders = action.payload.folders;
                if (
                    state.currentFolderId &&
                    !action.payload.folders.some((f) => f.id === state.currentFolderId)
                ) {
                    state.currentFolderId = null;
                }
            })
            .addCase(fetchTrash.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to load trash';
            });
    },
});

export const { setTrashFolderId, removeTrashFile, removeTrashFolder, clearTrash } =
    trashSlice.actions;
export const trashReducer = trashSlice.reducer;
