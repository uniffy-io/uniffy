/**
 * Tags API client.
 *
 * Wraps the ConnectRPC ``TagsService`` with the full surface area the
 * unified explorer (Phase 5) needs: tag CRUD, search, assignment,
 * content listing with criteria, and saved-filter CRUD.
 */

import { createClient } from '@connectrpc/connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import { transport } from '@/config/api';
import { TagsService } from '@uniffy/proto/tags/v1/tags_connect';
import type {
    AssignTagsRequest,
    CreateSavedFilterRequest,
    CreateTagRequest,
    DeleteSavedFilterRequest,
    DeleteTagRequest,
    GetTagRequest,
    GetTagsForUrnsRequest,
    ListContentByTagRequest,
    ListSavedFiltersRequest,
    ListTagsRequest,
    MergeTagsRequest,
    SuggestTagsRequest,
    UnassignTagsRequest,
    UpdateSavedFilterRequest,
    UpdateTagRequest,
} from '@uniffy/proto/tags/v1/tags_pb';

const tagsClient = createClient(TagsService, transport);

export const tagsApi = {
    createTag: (request: PartialMessage<CreateTagRequest>) => tagsClient.createTag(request),
    updateTag: (request: PartialMessage<UpdateTagRequest>) => tagsClient.updateTag(request),
    deleteTag: (request: PartialMessage<DeleteTagRequest>) => tagsClient.deleteTag(request),
    mergeTags: (request: PartialMessage<MergeTagsRequest>) => tagsClient.mergeTags(request),
    getTag: (request: PartialMessage<GetTagRequest>) => tagsClient.getTag(request),
    listTags: (request: PartialMessage<ListTagsRequest>) => tagsClient.listTags(request),
    suggestTags: (request: PartialMessage<SuggestTagsRequest>) =>
        tagsClient.suggestTags(request),
    assignTags: (request: PartialMessage<AssignTagsRequest>) => tagsClient.assignTags(request),
    unassignTags: (request: PartialMessage<UnassignTagsRequest>) =>
        tagsClient.unassignTags(request),
    getTagsForUrns: (request: PartialMessage<GetTagsForUrnsRequest>) =>
        tagsClient.getTagsForUrns(request),
    listContentByTag: (request: PartialMessage<ListContentByTagRequest>) =>
        tagsClient.listContentByTag(request),

    createSavedFilter: (request: PartialMessage<CreateSavedFilterRequest>) =>
        tagsClient.createSavedFilter(request),
    updateSavedFilter: (request: PartialMessage<UpdateSavedFilterRequest>) =>
        tagsClient.updateSavedFilter(request),
    deleteSavedFilter: (request: PartialMessage<DeleteSavedFilterRequest>) =>
        tagsClient.deleteSavedFilter(request),
    listSavedFilters: (request: PartialMessage<ListSavedFiltersRequest>) =>
        tagsClient.listSavedFilters(request),
};
