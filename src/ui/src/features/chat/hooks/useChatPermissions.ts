import { useMemo } from "react";
import { useAppSelector } from "@/app/hooks";
import { DomainType } from "@uniffy/proto/common/v1/common_pb";

export function useChatPermissions() {
  const orgRole = useAppSelector((s) => s.auth.currentOrganizationRole);
  const domainAdminDomains = useAppSelector((s) => s.auth.domainAdminDomains);

  return useMemo(() => {
    const isOrgAdmin = orgRole === "ADMIN" || orgRole === "OWNER";
    const isChatDomainAdmin = domainAdminDomains.includes(DomainType.CHAT);
    const canManageChat = isOrgAdmin || isChatDomainAdmin;

    return {
      isOrgAdmin,
      isChatDomainAdmin,
      canManageChat,
    };
  }, [orgRole, domainAdminDomains]);
}
