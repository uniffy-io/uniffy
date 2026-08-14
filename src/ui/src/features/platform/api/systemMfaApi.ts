import { createClient } from "@connectrpc/connect";
import { transport } from "@/config/api";
import { SystemMfaService } from "@uniffy/proto/superadmin/v1/system_mfa_pb";

export const systemMfaClient = createClient(SystemMfaService, transport);
