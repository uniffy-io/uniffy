import { createAsyncThunk } from "@reduxjs/toolkit";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { type ContentType, AccessMode as ProtoAccessMode } from "@uniffy/proto/common/v1/common_pb";
import {
  TagSort,
  TagFilterCriteriaSchema,
  type Tag,
  type TaggedContentItem,
  type TagFilterCriteria as ProtoTagFilterCriteria,
} from "@uniffy/proto/tags/v1/tags_pb";

import { tagsApi } from "@/features/tags/api/tagsApi";
import type { RootState } from "@/app/store";

const getOrgId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

export interface SerializedTag {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  createdBy: string;
  usageCount: number;
  urn: string;
}

export const tagToPlain = (tag: Tag): SerializedTag => ({
  id: tag.id,
  name: tag.name,
  slug: tag.slug,
  color: tag.color,
  description: tag.description,
  createdBy: tag.createdBy,
  usageCount: tag.usageCount,
  urn: tag.urn,
});

export interface SerializedTaggedContentItem {
  urn: string;
  contentType: ContentType;
  title: string;
  snippet: string;
  updatedAtMs: number | null;
  assignedAtMs: number | null;
}

const tsToMs = (ts: Timestamp | undefined): number | null =>
  ts ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000) : null;

export const taggedContentItemToPlain = (item: TaggedContentItem): SerializedTaggedContentItem => ({
  urn: item.urn,
  contentType: item.contentType,
  title: item.title,
  snippet: item.snippet,
  updatedAtMs: tsToMs(item.updatedAt),
  assignedAtMs: tsToMs(item.assignedAt),
});

export interface SerializedTagFilterCriteria {
  tagIds: string[];
  contentTypes: ContentType[];
  ownerIds: string[];
  sources: ("manual" | "inline")[];
  createdAfter: string | null;
  createdBefore: string | null;
  updatedAfter: string | null;
  updatedBefore: string | null;
  accessMode: ProtoAccessMode | null;
  untaggedOnly: boolean;
}

export const emptyCriteria = (): SerializedTagFilterCriteria => ({
  tagIds: [],
  contentTypes: [],
  ownerIds: [],
  sources: [],
  createdAfter: null,
  createdBefore: null,
  updatedAfter: null,
  updatedBefore: null,
  accessMode: null,
  untaggedOnly: false,
});

const protoTimestampToIso = (ts: Timestamp | undefined): string | null =>
  ts ? new Date(Number(ts.seconds) * 1000).toISOString() : null;

export const criteriaToPlain = (
  proto: ProtoTagFilterCriteria | undefined,
): SerializedTagFilterCriteria => {
  if (!proto) return emptyCriteria();
  return {
    tagIds: [...proto.tagIds],
    contentTypes: [...proto.contentTypes],
    ownerIds: [...proto.ownerIds],
    sources: proto.sources.filter(
      (s): s is "manual" | "inline" => s === "manual" || s === "inline",
    ),
    createdAfter: protoTimestampToIso(proto.createdAfter),
    createdBefore: protoTimestampToIso(proto.createdBefore),
    updatedAfter: protoTimestampToIso(proto.updatedAfter),
    updatedBefore: protoTimestampToIso(proto.updatedBefore),
    accessMode: proto.accessMode ?? null,
    untaggedOnly: proto.untaggedOnly,
  };
};

const isoToTimestamp = (value: string | null): Timestamp | undefined => {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return timestampFromDate(new Date(ms));
};

export const criteriaToProto = (
  criteria: SerializedTagFilterCriteria,
): MessageInitShape<typeof TagFilterCriteriaSchema> => ({
  tagIds: criteria.tagIds,
  contentTypes: criteria.contentTypes,
  ownerIds: criteria.ownerIds,
  sources: criteria.sources,
  createdAfter: isoToTimestamp(criteria.createdAfter),
  createdBefore: isoToTimestamp(criteria.createdBefore),
  updatedAfter: isoToTimestamp(criteria.updatedAfter),
  updatedBefore: isoToTimestamp(criteria.updatedBefore),
  accessMode: criteria.accessMode ?? undefined,
  untaggedOnly: criteria.untaggedOnly,
});

export const suggestTagsThunk = createAsyncThunk<
  SerializedTag[],
  { prefix: string; limit?: number },
  { state: RootState; rejectValue: string }
>("tags/suggest", async ({ prefix, limit }, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    const response = await tagsApi.suggestTags({
      organizationId,
      prefix,
      limit: limit ?? 10,
    });
    return response.tags.map(tagToPlain);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to suggest tags");
  }
});

export const createTagThunk = createAsyncThunk<
  SerializedTag,
  { name: string; color?: string; description?: string },
  { state: RootState; rejectValue: string }
>("tags/create", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    const response = await tagsApi.createTag({
      organizationId,
      name: params.name,
      color: params.color ?? "",
      description: params.description ?? "",
    });
    if (!response.tag) {
      return rejectWithValue("Tag creation returned no tag");
    }
    return tagToPlain(response.tag);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create tag");
  }
});

export const updateTagThunk = createAsyncThunk<
  SerializedTag,
  { tagId: string; name?: string; color?: string | null; description?: string },
  { state: RootState; rejectValue: string }
>("tags/update", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    const response = await tagsApi.updateTag({
      organizationId,
      tagId: params.tagId,
      name: params.name,
      color: params.color === null ? "" : params.color,
      description: params.description,
    });
    if (!response.tag) return rejectWithValue("Tag update returned no tag");
    return tagToPlain(response.tag);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update tag");
  }
});

export const deleteTagThunk = createAsyncThunk<
  string,
  { tagId: string },
  { state: RootState; rejectValue: string }
>("tags/delete", async ({ tagId }, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    await tagsApi.deleteTag({ organizationId, tagId });
    return tagId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete tag");
  }
});

export const mergeTagsThunk = createAsyncThunk<
  { sourceTagId: string; target: SerializedTag },
  { sourceTagId: string; targetTagId: string },
  { state: RootState; rejectValue: string }
>("tags/merge", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    const response = await tagsApi.mergeTags({
      organizationId,
      sourceTagId: params.sourceTagId,
      targetTagId: params.targetTagId,
    });
    if (!response.tag) return rejectWithValue("Merge returned no tag");
    return { sourceTagId: params.sourceTagId, target: tagToPlain(response.tag) };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to merge tags");
  }
});

export const listTagsThunk = createAsyncThunk<
  { tags: SerializedTag[]; nextPageToken: string },
  {
    query?: string;
    sort?: TagSort;
    contentTypes?: ContentType[];
    pageSize?: number;
    pageToken?: string;
  } | void,
  { state: RootState; rejectValue: string }
>("tags/list", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    const response = await tagsApi.listTags({
      organizationId,
      query: params?.query ?? "",
      sort: params?.sort ?? TagSort.RECENT_DESC,
      contentTypes: params?.contentTypes ?? [],
      pageSize: params?.pageSize ?? 100,
      pageToken: params?.pageToken ?? "",
    });
    return {
      tags: response.tags.map(tagToPlain),
      nextPageToken: response.nextPageToken,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to list tags");
  }
});

export interface ListContentByTagParams {
  tag: string;
  criteria?: SerializedTagFilterCriteria | null;
  pageSize?: number;
  pageToken?: string;
}

export const listContentByTagThunk = createAsyncThunk<
  {
    tag: string;
    items: SerializedTaggedContentItem[];
    nextPageToken: string;
    appended: boolean;
  },
  ListContentByTagParams,
  { state: RootState; rejectValue: string }
>("tags/listContentByTag", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrgId(getState());
    const response = await tagsApi.listContentByTag({
      organizationId,
      tag: params.tag,
      pageSize: params.pageSize ?? 100,
      pageToken: params.pageToken ?? "",
      criteria: params.criteria ? criteriaToProto(params.criteria) : undefined,
    });
    return {
      tag: params.tag,
      items: response.results.map(taggedContentItemToPlain),
      nextPageToken: response.nextPageToken,
      appended: Boolean(params.pageToken),
    };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to list content for tag",
    );
  }
});
