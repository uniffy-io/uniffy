import { createClient } from '@connectrpc/connect';
import { SearchService, ResolveUrnsRequestSchema, SearchRequestSchema } from '@uniffy/proto/search/v1/search_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { unaryTransport } from '@/config/api';

const searchClient = createClient(SearchService, unaryTransport);

export const searchApi = {
    /** `signal` lets a caller cancel a superseded search; without it a
     *  debounced-but-in-flight request runs to completion. */
    search: async (
        request: MessageInitShape<typeof SearchRequestSchema>,
        options?: { signal?: AbortSignal },
    ) => {
        return searchClient.search(request, { signal: options?.signal });
    },

    resolveUrns: async (request: MessageInitShape<typeof ResolveUrnsRequestSchema>) => {
        return searchClient.resolveUrns(request);
    },
};
