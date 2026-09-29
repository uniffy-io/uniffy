import { create } from "@bufbuild/protobuf";
import {
  UrnAvailability,
  UrnMetadataSchema,
  type UrnMetadata,
} from "@uniffy/proto/search/v1/search_pb";
import { searchApi } from "@/features/search/api/searchApi";
import { resolveUrnChunks } from "@/features/search/utils/urnResolutionChunks";

const BATCH_SIZE = 100;

/** Every requested reference must leave its loading state, even if the server omits it. */
export async function resolveMentionBatch(
  organizationId: string,
  urns: string[],
): Promise<Record<string, UrnMetadata>> {
  const uniqueUrns = [...new Set(urns)];
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueUrns.length; i += BATCH_SIZE) {
    chunks.push(uniqueUrns.slice(i, i + BATCH_SIZE));
  }

  const resolved: Record<string, UrnMetadata> = {};
  await resolveUrnChunks(chunks, {
    signal: new AbortController().signal,
    resolve: async (chunk, signal) => {
      let metadata: Record<string, UrnMetadata> = {};
      try {
        const response = await searchApi.resolveUrns({ organizationId, urns: chunk }, { signal });
        metadata = response.resolved;
      } catch {
        // A failed lookup says nothing about existence or access.
      }
      return Object.fromEntries(
        chunk.map((urn) => [
          urn,
          metadata[urn] ?? create(UrnMetadataSchema, { availability: UrnAvailability.UNAVAILABLE }),
        ]),
      );
    },
    onResolved: (batch) => Object.assign(resolved, batch),
  });
  return resolved;
}
