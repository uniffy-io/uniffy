import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  OrganizationsService,
  ListMembersRequestSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import { GroupsService, ListGroupsRequestSchema } from "@uniffy/proto/groups/v1/groups_pb";
import { PeopleService, ListCollaboratorsRequestSchema } from "@uniffy/proto/people/v1/people_pb";
import { transport } from "@core/api/transport";

const orgClient = createClient(OrganizationsService, transport);
const groupsClient = createClient(GroupsService, transport);
const peopleClient = createClient(PeopleService, transport);

/** Org-member and group lookups used to search + resolve sharing subjects. */
export const directoryApi = {
  listMembers: (req: MessageInitShape<typeof ListMembersRequestSchema>) =>
    orgClient.listMembers(req),
  listGroups: (req: MessageInitShape<typeof ListGroupsRequestSchema>) =>
    groupsClient.listGroups(req),
  /** The caller's own colleagues ranked by recent interaction, or a ranked search. */
  listCollaborators: (req: MessageInitShape<typeof ListCollaboratorsRequestSchema>) =>
    peopleClient.listCollaborators(req),
  recordPeoplePicks: (organizationId: string, userIds: string[]) =>
    peopleClient.recordPeoplePicks({ organizationId, userIds }),
};
