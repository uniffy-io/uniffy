/**
 * Storage Page
 *
 * Admin page for managing storage quotas and monitoring usage.
 * Accessible to org admins (files domain) and system admins.
 */

import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import {
    fetchOrgStorageQuota,
    fetchOrgStorageUsage,
    fetchUserStorageQuotaOverrides,
    fetchMembers,
} from '@/features/admin/store/adminThunks';
import { OrgQuotaSection } from '@/features/admin/components/storage/OrgQuotaSection';
import { UserQuotaTable } from '@/features/admin/components/storage/UserQuotaTable';

export function StoragePage() {
    useDocumentTitle('Storage Management');
    const dispatch = useAppDispatch();
    const membersFetched = useAppSelector((state) => state.admin.membersFetched);

    useEffect(() => {
        dispatch(fetchOrgStorageQuota());
        dispatch(fetchOrgStorageUsage());
        dispatch(fetchUserStorageQuotaOverrides());
        if (!membersFetched) {
            dispatch(fetchMembers({ pageSize: 500 }));
        }
    }, [dispatch, membersFetched]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-foreground">Storage Management</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Configure storage quotas and monitor usage across the organization.
                </p>
            </div>

            <OrgQuotaSection />
            <UserQuotaTable />
        </div>
    );
}
