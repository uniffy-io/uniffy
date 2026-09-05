import { createClient } from "@connectrpc/connect";
import { RulesService } from "@uniffy/proto/agents/v1/rules_pb";
import { unaryTransport } from "@/config/api";

export const rulesApi = createClient(RulesService, unaryTransport);
