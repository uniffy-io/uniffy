import { createClient } from "@connectrpc/connect";
import type { PartialMessage } from "@bufbuild/protobuf";
import { SearchService } from "@/gen/search/v1/search_connect";
import type { SearchRequest, ResolveUrnsRequest } from "@/gen/search/v1/search_pb";
import { transport } from "@/lib/transport";

const client = createClient(SearchService, transport);

export const searchApi = {
  search: (request: PartialMessage<SearchRequest>) => client.search(request),

  resolveUrns: (request: PartialMessage<ResolveUrnsRequest>) => client.resolveUrns(request),
};
