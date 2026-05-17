import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { SearchService, ResolveUrnsRequestSchema, SearchRequestSchema } from "@uniffy/proto/search/v1/search_pb";
import { transport } from "@/lib/transport";

const client = createClient(SearchService, transport);

export const searchApi = {
  search: (request: MessageInitShape<typeof SearchRequestSchema>) => client.search(request),

  resolveUrns: (request: MessageInitShape<typeof ResolveUrnsRequestSchema>) => client.resolveUrns(request),
};
