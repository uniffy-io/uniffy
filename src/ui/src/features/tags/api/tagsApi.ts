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
    CreateSavedTagFilterRequest,
    CreateTagRequest,
    DeleteSavedTagFilterRequest,
    DeleteTagRequest,
    GetTagRequest,
    GetTagsForUrnsRequest,
    ListContentByTagRequest,
    ListSavedTagFiltersRequest,
    ListTagsRequest,
    MergeTagsRequest,
    SuggestTagsRequest,
    UnassignTagsRequest,
    UpdateSavedTagFilterRequest,
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

    createSavedFilter: (request: PartialMessage<CreateSavedTagFilterRequest>) =>
        tagsClient.createSavedFilter(request),
    updateSavedFilter: (request: PartialMessage<UpdateSavedTagFilterRequest>) =>
        tagsClient.updateSavedFilter(request),
    deleteSavedFilter: (request: PartialMessage<DeleteSavedTagFilterRequest>) =>
        tagsClient.deleteSavedFilter(request),
    listSavedFilters: (request: PartialMessage<ListSavedTagFiltersRequest>) =>
        tagsClient.listSavedFilters(request),
};
