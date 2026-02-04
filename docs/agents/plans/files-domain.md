# Files Domain Implementation Plan

## Overview

Create a Files domain for Uniffy with S3-compatible storage (MinIO for self-hosted), supporting unlimited file sizes via streaming uploads through backend, full permission integration, and metadata-only search (with skeleton for future full-text extraction).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | S3-compatible (MinIO) | HA-ready, scalable, industry standard |
| Upload method | Streaming through backend | S3 is internal-only, not exposed to browser |
| Large files | ConnectRPC client streaming + S3 multipart | Resumable, no size limits |
| Download | ConnectRPC server streaming | Stream from S3 through backend to browser |
| Search | Metadata only (extraction skeleton for later) | Filename, tags, mime type now; full-text via background jobs later |
| Hierarchy | Folders model | Separate table for folders, files reference folder_id |

## Streaming Architecture (HTTP/2 + ConnectRPC)

### Upload Flow (Client Streaming RPC)
```
Browser                    Backend                         S3 (internal)
   |                          |                               |
   |-- InitiateUpload ------->|                               |
   |<-- {upload_id, ...} -----|                               |
   |                          |-- CreateMultipartUpload ----->|
   |                          |<-- {s3_upload_id} ------------|
   |                          |                               |
   |== UploadChunk (stream) =>|                               |
   |   {chunk_data, seq}      |-- UploadPart ---------------->|
   |                          |<-- {etag} --------------------|
   |<-- {ack: seq} -----------|                               |
   |   ...repeats...          |                               |
   |                          |                               |
   |-- CompleteUpload ------->|                               |
   |                          |-- CompleteMultipartUpload --->|
   |<-- {file} ---------------|                               |
```

### Download Flow (Server Streaming RPC)
```
Browser                    Backend                         S3 (internal)
   |                          |                               |
   |-- DownloadFile --------->|                               |
   |                          |-- GetObject ----------------->|
   |                          |<== stream ====================|
   |<== DownloadChunk (stream)|                               |
   |   {chunk_data, seq}      |                               |
   |   ...repeats...          |                               |
```

### Resumable Uploads
- Backend tracks `parts_completed` in `files_multipart_uploads` table
- If connection drops, client calls `GetUploadStatus(upload_id)`
- Backend returns: "chunks 1-5 confirmed, resume from chunk 6"
- Client reconnects and continues streaming from last confirmed chunk
- S3 multipart uploads can stay open for days (configurable expiry)

## Database Schema

### New Tables

```sql
-- Main files table
files_files
├── id (UUID, PK)
├── organization_id (FK → organizations)
├── owner_id (FK → users)
├── filename (current name)
├── original_filename (upload name)
├── mime_type, size_bytes
├── storage_key, storage_bucket (S3 location)
├── visibility (VisibilityScope enum)
├── folder_id (FK → files_folders, nullable)
├── tags (JSONB array)
├── description (text)
├── file_metadata (JSONB - dimensions, duration, etc.)
├── version (int)
├── current_version_id (FK → versions, nullable)
├── extraction_status (enum: pending, processing, completed, failed, skipped)
├── is_deleted, deleted_at
└── created_at, updated_at

-- Folder hierarchy
files_folders
├── id (UUID, PK)
├── organization_id, owner_id
├── name
├── parent_id (self-reference, nullable for root)
├── visibility
├── is_deleted, deleted_at
└── created_at, updated_at

-- Version history
files_file_versions
├── id (UUID, PK)
├── file_id (FK → files_files)
├── version_number
├── size_bytes
├── storage_key, storage_bucket
├── checksum_sha256
├── uploaded_by (FK → users)
└── created_at

-- Track in-progress uploads for resumability
files_multipart_uploads
├── id (UUID, PK)
├── organization_id, user_id
├── s3_upload_id (from S3 CreateMultipartUpload)
├── storage_key, storage_bucket
├── filename, mime_type
├── total_size (expected), total_parts (expected)
├── chunk_size (bytes per chunk)
├── folder_id, visibility
├── status (enum: active, completed, aborted, expired)
├── parts_completed (JSONB: [{part_number, etag, size}])
├── expires_at
└── created_at, updated_at
```

### Extraction Status (Skeleton for Future)

The `extraction_status` field prepares for future background job integration:

```python
class ExtractionStatus(str, Enum):
    PENDING = "pending"      # Queued for extraction (when queue exists)
    PROCESSING = "processing" # Currently being processed
    COMPLETED = "completed"   # Text extracted, indexed in Meilisearch
    FAILED = "failed"        # Extraction failed (unsupported format, corrupt, etc.)
    SKIPPED = "skipped"      # Not applicable (e.g., binary files)
```

**Future integration point** (TODO - requires background job system):
```python
# In FileOperations.create(), after file is saved:
# if mime_type in EXTRACTABLE_TYPES:
#     await job_queue.enqueue("extract_file_text", file_id=file.id)
#     # Job worker will:
#     # 1. Download file from S3
#     # 2. Extract text (pdf, docx, etc.)
#     # 3. Update Meilisearch index with extracted text
#     # 4. Set extraction_status = completed/failed
```

## Files to Create/Modify

### Backend - New Files

| File | Purpose |
|------|---------|
| `src/uniffy/core/models/files/__init__.py` | Model exports |
| `src/uniffy/core/models/files/file.py` | File model |
| `src/uniffy/core/models/files/folder.py` | Folder model |
| `src/uniffy/core/models/files/file_version.py` | FileVersion model |
| `src/uniffy/core/models/files/multipart_upload.py` | MultipartUpload model |
| `src/uniffy/core/storage/__init__.py` | Storage exports |
| `src/uniffy/core/storage/s3_client.py` | Async S3 client wrapper |
| `src/proto/files/v1/files.proto` | Service definition with streaming RPCs |
| `src/uniffy/domains/files/__init__.py` | Domain exports |
| `src/uniffy/domains/files/operations.py` | FileOperations(BaseContentOperations) |
| `src/uniffy/domains/files/folder_operations.py` | FolderOperations |
| `src/uniffy/domains/files/upload_operations.py` | Upload/download streaming logic |
| `src/uniffy/domains/files/handlers.py` | RPC handlers |
| `src/uniffy/domains/files/converters.py` | Proto ↔ model mapping |
| `src/uniffy/domains/files/service.py` | Service class |
| `src/uniffy/db/migrations/xxx_create_files_tables.py` | Alembic migration |

### Backend - Modify

| File | Change |
|------|--------|
| `src/uniffy/core/models/__init__.py` | Export File, Folder, FileVersion |
| `src/uniffy/factory.py` | Mount FilesService |
| `pyproject.toml` | Add `aioboto3` dependency |

### Frontend - New Files

| File | Purpose |
|------|---------|
| `src/ui/src/features/files/api/filesApi.ts` | API client with streaming |
| `src/ui/src/features/files/store/filesSlice.ts` | File state |
| `src/ui/src/features/files/store/filesTreeSlice.ts` | Tree state |
| `src/ui/src/features/files/store/filesThunks.ts` | Async actions |
| `src/ui/src/features/files/store/uploadSlice.ts` | Upload queue & progress |
| `src/ui/src/features/files/hooks/useFilesHooks.ts` | Domain hooks |
| `src/ui/src/features/files/hooks/useUpload.ts` | Streaming upload logic |
| `src/ui/src/features/files/hooks/useDownload.ts` | Streaming download logic |
| `src/ui/src/features/files/components/FilesLayout.tsx` | Main layout |
| `src/ui/src/features/files/components/sidebar/FilesSidebar.tsx` | Tree sidebar |
| `src/ui/src/features/files/components/list/FilesList.tsx` | Grid/list view |
| `src/ui/src/features/files/components/list/FileCard.tsx` | File card |
| `src/ui/src/features/files/components/upload/UploadDropzone.tsx` | Drag & drop |
| `src/ui/src/features/files/components/upload/UploadProgress.tsx` | Progress UI |
| `src/ui/src/features/files/pages/FilesPage.tsx` | Page component |
| `src/ui/src/features/files/index.ts` | Public exports |

### Frontend - Modify

| File | Change |
|------|--------|
| `src/ui/src/app/store.ts` | Add files reducers |
| `src/ui/src/app/router.tsx` | Add /files routes |

## Proto Service Definition

```protobuf
syntax = "proto3";
package files.v1;

import "common/v1/common.proto";

service FilesService {
  // === Upload (Client Streaming) ===
  // Initialize upload session, returns upload_id
  rpc InitiateUpload(InitiateUploadRequest) returns (InitiateUploadResponse);

  // Stream chunks to backend (client streaming RPC)
  rpc UploadChunks(stream UploadChunkRequest) returns (UploadChunksResponse);

  // Get status of in-progress upload (for resume)
  rpc GetUploadStatus(GetUploadStatusRequest) returns (GetUploadStatusResponse);

  // Abort an in-progress upload
  rpc AbortUpload(AbortUploadRequest) returns (AbortUploadResponse);

  // === Download (Server Streaming) ===
  // Stream file content to client (server streaming RPC)
  rpc DownloadFile(DownloadFileRequest) returns (stream DownloadChunkResponse);

  // === File CRUD ===
  rpc GetFile(GetFileRequest) returns (FileResponse);
  rpc UpdateFile(UpdateFileRequest) returns (FileResponse);
  rpc DeleteFile(DeleteFileRequest) returns (DeleteFileResponse);
  rpc RestoreFile(RestoreFileRequest) returns (FileResponse);
  rpc ListFiles(ListFilesRequest) returns (ListFilesResponse);

  // === Folders ===
  rpc CreateFolder(CreateFolderRequest) returns (FolderResponse);
  rpc UpdateFolder(UpdateFolderRequest) returns (FolderResponse);
  rpc DeleteFolder(DeleteFolderRequest) returns (DeleteFolderResponse);
  rpc GetFilesTree(GetFilesTreeRequest) returns (GetFilesTreeResponse);

  // === Operations ===
  rpc MoveItems(MoveItemsRequest) returns (MoveItemsResponse);
  rpc CopyItems(CopyItemsRequest) returns (CopyItemsResponse);
  rpc BulkDelete(BulkDeleteRequest) returns (BulkDeleteResponse);
  rpc EmptyTrash(EmptyTrashRequest) returns (EmptyTrashResponse);

  // === Versions ===
  rpc ListFileVersions(ListFileVersionsRequest) returns (ListFileVersionsResponse);
  rpc RestoreFileVersion(RestoreFileVersionRequest) returns (FileResponse);
}

// === Messages ===

message InitiateUploadRequest {
  string filename = 1;
  string mime_type = 2;
  int64 total_size = 3;
  optional string folder_id = 4;
  common.v1.VisibilityScope visibility = 5;
}

message InitiateUploadResponse {
  string upload_id = 1;
  int32 chunk_size = 2;  // Recommended chunk size in bytes
  int32 total_chunks = 3;
}

message UploadChunkRequest {
  string upload_id = 1;
  int32 chunk_number = 2;  // 1-indexed
  bytes data = 3;
  bool is_last = 4;
}

message UploadChunksResponse {
  File file = 1;  // Completed file
}

message GetUploadStatusRequest {
  string upload_id = 1;
}

message GetUploadStatusResponse {
  string upload_id = 1;
  repeated int32 completed_chunks = 2;
  int32 total_chunks = 3;
  UploadStatus status = 4;
}

enum UploadStatus {
  UPLOAD_STATUS_UNSPECIFIED = 0;
  UPLOAD_STATUS_ACTIVE = 1;
  UPLOAD_STATUS_COMPLETED = 2;
  UPLOAD_STATUS_ABORTED = 3;
  UPLOAD_STATUS_EXPIRED = 4;
}

message DownloadFileRequest {
  string file_id = 1;
  optional string version_id = 2;  // Download specific version
}

message DownloadChunkResponse {
  bytes data = 1;
  int32 chunk_number = 2;
  int32 total_chunks = 3;
  // First chunk includes metadata
  optional string filename = 4;
  optional string mime_type = 5;
  optional int64 total_size = 6;
}

message File {
  string id = 1;
  string urn = 2;
  string filename = 3;
  string original_filename = 4;
  string mime_type = 5;
  int64 size_bytes = 6;
  common.v1.VisibilityScope visibility = 7;
  optional string folder_id = 8;
  repeated string tags = 9;
  optional string description = 10;
  int32 version = 11;
  ExtractionStatus extraction_status = 12;
  string owner_id = 13;
  google.protobuf.Timestamp created_at = 14;
  google.protobuf.Timestamp updated_at = 15;
}

enum ExtractionStatus {
  EXTRACTION_STATUS_UNSPECIFIED = 0;
  EXTRACTION_STATUS_PENDING = 1;
  EXTRACTION_STATUS_PROCESSING = 2;
  EXTRACTION_STATUS_COMPLETED = 3;
  EXTRACTION_STATUS_FAILED = 4;
  EXTRACTION_STATUS_SKIPPED = 5;
}

message Folder {
  string id = 1;
  string urn = 2;
  string name = 3;
  optional string parent_id = 4;
  common.v1.VisibilityScope visibility = 5;
  string owner_id = 6;
  google.protobuf.Timestamp created_at = 7;
  google.protobuf.Timestamp updated_at = 8;
}

// ... additional request/response messages ...
```

## Permission Integration

Uses existing permission system automatically via `BaseContentOperations`:

- **VisibilityScope**: PRIVATE (owner only), GROUP (linked groups), ORGANIZATION (all members)
- **ContentGroupLink**: Links files to groups when visibility=GROUP
- **ContentPermission**: Fine-grained VIEW/EDIT/ADMIN/OWNER grants
- **PermissionChecker**: Called automatically by base class

No new permission code needed - just extend `BaseContentOperations[File]`.

## Search Integration

Already configured in codebase:
- `SEARCH_RESULT_TYPE_FILE` exists in search.proto
- `CONTENT_TYPE_FILE` exists in common.proto
- Frontend has FILE in urnTypes, urnColors, contentTypes

Implement in `FileOperations`:
```python
def _build_search_keywords(self, model: File) -> str:
    parts = [model.filename, model.original_filename]
    if model.tags:
        parts.extend(model.tags)
    if model.description:
        parts.append(model.description)
    if model.mime_type:
        parts.append(model.mime_type)
    return " ".join(filter(None, parts))
```

**Future**: When extraction is implemented, the background job will update Meilisearch directly with extracted text.

## Environment Variables

```bash
# S3/MinIO Configuration (internal, not exposed to browser)
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET_NAME=uniffy-files
S3_REGION=us-east-1
S3_USE_SSL=false

# Upload settings
UPLOAD_CHUNK_SIZE=5242880  # 5MB chunks
UPLOAD_MAX_SIZE=10737418240  # 10GB max file size
UPLOAD_EXPIRY_HOURS=24  # Incomplete uploads expire after 24h
```

## Implementation Order

### Phase 1: Backend Core
1. Add `aioboto3` to pyproject.toml
2. Create S3 client (`core/storage/s3_client.py`)
3. Create database models (File, Folder, FileVersion, MultipartUpload)
4. Create Alembic migration
5. Define proto service with streaming RPCs
6. Run `./run.sh proto`
7. Implement FileOperations (extends BaseContentOperations)
8. Implement streaming upload/download handlers
9. Mount service in factory.py

### Phase 2: Basic Frontend
1. Create filesApi client with streaming support
2. Create Redux slices (files, filesTree, upload)
3. Build FilesPage with basic list view
4. Implement streaming upload with progress
5. Implement streaming download
6. Add routes

### Phase 3: Advanced Features
1. Resumable uploads (reconnect and continue)
2. Folder operations (create, move, delete)
3. File tree sidebar
4. Drag & drop upload zone
5. Bulk operations (move, delete)

### Phase 4: Polish
1. Upload queue with progress UI
2. File preview panel (images, PDFs)
3. Version history UI
4. Zen mode support
5. Keyboard shortcuts

## Verification Checklist

- [ ] **Backend starts**: `./run.sh dev` - service mounts without errors
- [ ] **Upload small file**: Stream upload completes, file in MinIO
- [ ] **Upload large file**: 100MB+ file uploads with chunking
- [ ] **Resume upload**: Kill connection mid-upload, resume successfully
- [ ] **Download file**: Stream download works, file intact
- [ ] **Permissions**: PRIVATE file not accessible by other users
- [ ] **Search**: Upload file, search by filename finds it
- [ ] **Frontend**: Navigate to /files, upload/download works

## Future Work (Out of Scope)

- [ ] Background job system for text extraction
- [ ] Full-text search of file contents (PDF, DOCX, etc.)
- [ ] File preview generation (thumbnails, PDF preview)
- [ ] Virus scanning integration
- [ ] Encryption at rest
- [ ] Quota management per user/organization
