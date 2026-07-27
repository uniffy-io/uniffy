import { useMemo } from 'react';
import { useAppSelector } from '@/app/hooks';
import { DomainType } from '@uniffy/proto/common/v1/common_pb';

export function useAgentsBuilderAccess() {
    const orgRole = useAppSelector((s) => s.auth.currentOrganizationRole);
    const domainAdminDomains = useAppSelector((s) => s.auth.domainAdminDomains);

    return useMemo(() => {
        const isOrgAdmin = orgRole === 'ADMIN' || orgRole === 'OWNER';
        const isAgentsDomainAdmin = domainAdminDomains.includes(DomainType.AGENTS);

        return {
            isOrgAdmin,
            isAgentsDomainAdmin,
            isBuilder: isOrgAdmin || isAgentsDomainAdmin,
        };
    }, [orgRole, domainAdminDomains]);
}
