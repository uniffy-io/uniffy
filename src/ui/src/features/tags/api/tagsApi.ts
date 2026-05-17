/**
 * Tags API client.
 *
 * Wraps the ConnectRPC ``TagsService`` with the full surface area the
 * unified explorer (Phase 5) needs: tag CRUD, search, assignment,
 * content listing with criteria, and saved-filter CRUD.
 */

import { createClient } from '@connectrpc/connect';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';
import {
    TagsService,
    AssignTagsRequestSchema,
    CreateSavedFilterRequestSchema,
    CreateTagRequestSchema,
    DeleteSavedFilterRequestSchema,
    DeleteTagRequestSchema,
    GetTagRequestSchema,
    GetTagsForUrnsRequestSchema,
    ListContentByTagRequestSchema,
    ListSavedFiltersRequestSchema,
    ListTagsRequestSchema,
    MergeTagsRequestSchema,
    SuggestTagsRequestSchema,
    UnassignTagsRequestSchema,
    UpdateSavedFilterRequestSchema,
    UpdateTagRequestSchema,
} from '@uniffy/proto/tags/v1/tags_pb';

const tagsClient = createClient(TagsService, unaryTransport);

export const tagsApi = {
    createTag: (request: MessageInitShape<typeof CreateTagRequestSchema>) => tagsClient.createTag(request),
    updateTag: (request: MessageInitShape<typeof UpdateTagRequestSchema>) => tagsClient.updateTag(request),
    deleteTag: (request: MessageInitShape<typeof DeleteTagRequestSchema>) => tagsClient.deleteTag(request),
    mergeTags: (request: MessageInitShape<typeof MergeTagsRequestSchema>) => tagsClient.mergeTags(request),
    getTag: (request: MessageInitShape<typeof GetTagRequestSchema>) => tagsClient.getTag(request),
    listTags: (request: MessageInitShape<typeof ListTagsRequestSchema>) => tagsClient.listTags(request),
    suggestTags: (request: MessageInitShape<typeof SuggestTagsRequestSchema>) =>
        tagsClient.suggestTags(request),
    assignTags: (request: MessageInitShape<typeof AssignTagsRequestSchema>) => tagsClient.assignTags(request),
    unassignTags: (request: MessageInitShape<typeof UnassignTagsRequestSchema>) =>
        tagsClient.unassignTags(request),
    getTagsForUrns: (request: MessageInitShape<typeof GetTagsForUrnsRequestSchema>) =>
        tagsClient.getTagsForUrns(request),
    listContentByTag: (request: MessageInitShape<typeof ListContentByTagRequestSchema>) =>
        tagsClient.listContentByTag(request),

    createSavedFilter: (request: MessageInitShape<typeof CreateSavedFilterRequestSchema>) =>
        tagsClient.createSavedFilter(request),
    updateSavedFilter: (request: MessageInitShape<typeof UpdateSavedFilterRequestSchema>) =>
        tagsClient.updateSavedFilter(request),
    deleteSavedFilter: (request: MessageInitShape<typeof DeleteSavedFilterRequestSchema>) =>
        tagsClient.deleteSavedFilter(request),
    listSavedFilters: (request: MessageInitShape<typeof ListSavedFiltersRequestSchema>) =>
        tagsClient.listSavedFilters(request),
};
