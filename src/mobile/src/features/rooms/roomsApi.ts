import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  RoomsService,
  FindAvailableRoomsRequestSchema,
  ListRoomsRequestSchema,
} from "@uniffy/proto/rooms/v1/rooms_pb";
import { transport } from "@core/api/transport";

const client = createClient(RoomsService, transport);

export const roomsApi = {
  listRooms: (request: MessageInitShape<typeof ListRoomsRequestSchema>) =>
    client.listRooms(request),

  findAvailableRooms: (request: MessageInitShape<typeof FindAvailableRoomsRequestSchema>) =>
    client.findAvailableRooms(request),
};
