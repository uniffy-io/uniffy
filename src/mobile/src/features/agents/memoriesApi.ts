import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  MemoriesService,
  ListMemoriesRequestSchema,
  CreateMemoryRequestSchema,
  UpdateMemoryRequestSchema,
  DeleteMemoryRequestSchema,
  SetMemoryPinnedRequestSchema,
} from "@uniffy/proto/agents/v1/memories_pb";
import { transport } from "@core/api/transport";

const client = createClient(MemoriesService, transport);

export const memoriesApi = {
  listMemories: (req: MessageInitShape<typeof ListMemoriesRequestSchema>) =>
    client.listMemories(req),
  createMemory: (req: MessageInitShape<typeof CreateMemoryRequestSchema>) =>
    client.createMemory(req),
  updateMemory: (req: MessageInitShape<typeof UpdateMemoryRequestSchema>) =>
    client.updateMemory(req),
  deleteMemory: (req: MessageInitShape<typeof DeleteMemoryRequestSchema>) =>
    client.deleteMemory(req),
  setMemoryPinned: (req: MessageInitShape<typeof SetMemoryPinnedRequestSchema>) =>
    client.setMemoryPinned(req),
};
