import { createAsyncThunk } from "@reduxjs/toolkit";
import { filesApi } from "@/features/files/api/filesApi";
import { openViewer, setFileData, setError } from "@/features/files/store/viewerSlice";
import { bulkUpsertTags, tagToPlain } from "@/features/tags";
import type { RootState, AppDispatch } from "@/app/store";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import type { File } from "@uniffy/proto/files/v1/files_pb";

// Duplicated from filesThunks to avoid a circular import.
const fileToPlain = (file: File): SerializedFile => ({
  id: file.id,
  urn: file.urn,
  organizationId: file.organizationId,
  ownerId: file.ownerId,
  accessMode: file.accessMode,
  baselineRole: file.baselineRole ?? null,
  userRole: file.userRole,
  filename: file.filename,
  originalFilename: file.originalFilename,
  mimeType: file.mimeType,
  sizeBytes: typeof file.sizeBytes === "bigint" ? Number(file.sizeBytes) : file.sizeBytes,
  folderId: file.folderId,
  tagIds: file.tags.map((tag) => tag.id),
  description: file.description,
  version: file.version,
  extractionStatus: file.extractionStatus,
  transcodeStatus: file.transcodeStatus,
  playbackStatus: file.playbackStatus,
  isDeleted: file.isDeleted,
  createdAt: file.createdAt
    ? {
        seconds:
          typeof file.createdAt.seconds === "bigint"
            ? Number(file.createdAt.seconds)
            : file.createdAt.seconds,
        nanos:
          typeof file.createdAt.nanos === "bigint"
            ? Number(file.createdAt.nanos)
            : file.createdAt.nanos,
      }
    : undefined,
  updatedAt: file.updatedAt
    ? {
        seconds:
          typeof file.updatedAt.seconds === "bigint"
            ? Number(file.updatedAt.seconds)
            : file.updatedAt.seconds,
        nanos:
          typeof file.updatedAt.nanos === "bigint"
            ? Number(file.updatedAt.nanos)
            : file.updatedAt.nanos,
      }
    : undefined,
  deletedAt: file.deletedAt
    ? {
        seconds:
          typeof file.deletedAt.seconds === "bigint"
            ? Number(file.deletedAt.seconds)
            : file.deletedAt.seconds,
        nanos:
          typeof file.deletedAt.nanos === "bigint"
            ? Number(file.deletedAt.nanos)
            : file.deletedAt.nanos,
      }
    : undefined,
  groupIds: [...file.groupIds],
  ownerInfo: file.ownerInfo
    ? {
        id: file.ownerInfo.id,
        name: file.ownerInfo.name,
        email: file.ownerInfo.email,
      }
    : undefined,
  metadata: file.metadata
    ? {
        hasThumbnail: file.metadata.hasThumbnail,
        width: file.metadata.width,
        height: file.metadata.height,
        format: file.metadata.format,
        colorMode: file.metadata.colorMode,
        durationSeconds: file.metadata.durationSeconds,
        pageCount: file.metadata.pageCount,
        bitrate: file.metadata.bitrate,
        sampleRate: file.metadata.sampleRate,
        channels: file.metadata.channels,
        exif: { ...file.metadata.exif },
        error: file.metadata.error,
      }
    : undefined,
});

/** Opens the viewer immediately (loading state) and lazily fetches the file when it isn't already cached in the files slice. */
export const openViewerWithFetch = createAsyncThunk<
  void,
  { fileId: string },
  { state: RootState; dispatch: AppDispatch; rejectValue: string }
>("fileViewer/openWithFetch", async ({ fileId }, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const organizationId = state.auth.currentOrganizationId;

  if (!organizationId) {
    return rejectWithValue("No organization selected");
  }

  const existingFile = state.files.files[fileId];

  if (existingFile) {
    dispatch(openViewer({ fileId, fileData: existingFile }));
    return;
  }

  dispatch(openViewer({ fileId }));

  try {
    const response = await filesApi.getFile({
      fileId,
      organizationId,
    });

    if (!response.file) {
      dispatch(setError("File not found"));
      return rejectWithValue("File not found");
    }

    if (response.file.tags.length > 0) {
      dispatch(bulkUpsertTags(response.file.tags.map(tagToPlain)));
    }
    const fileData = fileToPlain(response.file);
    dispatch(setFileData(fileData));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch file";
    dispatch(setError(message));
    return rejectWithValue(message);
  }
});
