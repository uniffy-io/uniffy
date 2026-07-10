import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  OrganizationsService,
  ListMembersRequestSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import { GroupsService, ListGroupsRequestSchema } from "@uniffy/proto/groups/v1/groups_pb";
import { transport } from "@/lib/transport";

const orgClient = createClient(OrganizationsService, transport);
const groupsClient = createClient(GroupsService, transport);

/** Org-member and group lookups used to search + resolve sharing subjects. */
export const directoryApi = {
  listMembers: (req: MessageInitShape<typeof ListMembersRequestSchema>) =>
    orgClient.listMembers(req),
  listGroups: (req: MessageInitShape<typeof ListGroupsRequestSchema>) =>
    groupsClient.listGroups(req),
};
