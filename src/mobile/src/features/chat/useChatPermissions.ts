import { useMemo } from "react";
import { DomainType } from "@uniffy/proto/common/v1/common_pb";
import { useAuth } from "@core/providers/AuthContext";

/**
 * Chat moderation powers. Org admins and chat domain admins moderate every
 * channel - the deliberate carve-out in the permission model. These only drive
 * affordances; the backend is the gate.
 */
export function useChatPermissions() {
  const { organizationRole, domainAdminDomains } = useAuth();

  return useMemo(() => {
    const isOrgAdmin = organizationRole === "ADMIN" || organizationRole === "OWNER";
    const isChatDomainAdmin = domainAdminDomains.includes(DomainType.CHAT);
    return { isOrgAdmin, isChatDomainAdmin, canManageChat: isOrgAdmin || isChatDomainAdmin };
  }, [organizationRole, domainAdminDomains]);
}
