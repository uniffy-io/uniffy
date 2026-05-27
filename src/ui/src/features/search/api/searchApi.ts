import { createClient } from '@connectrpc/connect';
import { SearchService, ResolveUrnsRequestSchema, SearchRequestSchema } from '@uniffy/proto/search/v1/search_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';

const searchClient = createClient(SearchService, unaryTransport);

export const searchApi = {
    search: async (request: MessageInitShape<typeof SearchRequestSchema>) => {
        return searchClient.search(request);
    },

    resolveUrns: async (request: MessageInitShape<typeof ResolveUrnsRequestSchema>) => {
        return searchClient.resolveUrns(request);
    },
};
