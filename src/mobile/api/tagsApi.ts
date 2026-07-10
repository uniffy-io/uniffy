import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  TagsService,
  ListTagsRequestSchema,
  ListContentByTagRequestSchema,
  CreateTagRequestSchema,
  UpdateTagRequestSchema,
  DeleteTagRequestSchema,
} from "@uniffy/proto/tags/v1/tags_pb";
import { transport } from "@/lib/transport";

const client = createClient(TagsService, transport);

export const tagsApi = {
  listTags: (req: MessageInitShape<typeof ListTagsRequestSchema>) => client.listTags(req),
  listContentByTag: (req: MessageInitShape<typeof ListContentByTagRequestSchema>) =>
    client.listContentByTag(req),
  createTag: (req: MessageInitShape<typeof CreateTagRequestSchema>) => client.createTag(req),
  updateTag: (req: MessageInitShape<typeof UpdateTagRequestSchema>) => client.updateTag(req),
  deleteTag: (req: MessageInitShape<typeof DeleteTagRequestSchema>) => client.deleteTag(req),
};
