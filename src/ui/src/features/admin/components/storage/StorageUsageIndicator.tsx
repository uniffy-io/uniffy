import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";
import { setMyStorageUsage, setMyStorageUsageLoading } from "@/features/files/store/filesSlice";
import { storageApi } from "@/features/admin/api/storageApi";
import { StorageProgressBar } from "@/features/admin/components/storage/StorageProgressBar";
import { cn } from "@/shared/utils/cn";

interface StorageUsageIndicatorProps {
  className?: string;
}

export function StorageUsageIndicator({ className }: StorageUsageIndicatorProps) {
  const dispatch = useAppDispatch();
  const { canAccessAdmin } = useAdminAccess();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id);
  const myStorageUsage = useAppSelector((state) => state.files.myStorageUsage);

  useEffect(() => {
    if (!organizationId || !userId) return;

    let cancelled = false;

    async function fetchUsage() {
      dispatch(setMyStorageUsageLoading(true));
      try {
        const response = await storageApi.getStorageUsage({
          organizationId: organizationId!,
          userId: userId!,
        });
        if (cancelled) return;
        const usage = response.usage;
        dispatch(
          setMyStorageUsage({
            usedBytes: Number(usage?.usedBytes ?? 0),
            quotaBytes:
              usage?.effectiveQuotaBytes != null ? Number(usage.effectiveQuotaBytes) : null,
            usagePercent: usage?.usagePercent ?? 0,
            fileCount: usage?.fileCount ?? 0,
          }),
        );
      } catch {
        if (!cancelled) {
          dispatch(setMyStorageUsageLoading(false));
        }
      }
    }

    fetchUsage();
    return () => {
      cancelled = true;
    };
  }, [organizationId, userId, dispatch]);

  if (myStorageUsage.loading && myStorageUsage.usedBytes === 0) {
    return null;
  }

  const content = (
    <div className={cn("px-3 py-2", className)}>
      <StorageProgressBar
        usedBytes={myStorageUsage.usedBytes}
        quotaBytes={myStorageUsage.quotaBytes}
        showLabels={true}
        size="sm"
      />
    </div>
  );

  if (canAccessAdmin) {
    return (
      <Link
        to="/admin/storage"
        className="block hover:bg-foreground/5 rounded-md transition-colors"
      >
        {content}
      </Link>
    );
  }

  return content;
}
