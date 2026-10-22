import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/config";
import { organizationsApi } from "@/features/auth/api/organizationsApi";
import { leaveCurrentOrganizationScope } from "@/features/auth/components/leaveOrganizationScope";

interface LeaveOrganizationCardProps {
  organizationId: string;
  organizationName: string;
}

export function LeaveOrganizationCard({
  organizationId,
  organizationName,
}: LeaveOrganizationCardProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const consequence = `You lose access to everything in ${organizationName}. An admin can invite you back.`;

  const leave = async () => {
    if (leaving || !userId) return;
    setLeaving(true);
    try {
      await organizationsApi.leaveOrganization({ organizationId });
    } catch (err) {
      const message = friendlyErrorMessage(err instanceof Error ? err.message : String(err));
      if (message) toast.error(message);
      setLeaving(false);
      return;
    }
    await leaveCurrentOrganizationScope(dispatch, { organizationId, userId, navigate });
    toast.success(`You left ${organizationName}.`);
  };

  return (
    <Card tone="surface" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center md:p-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground">Leave organization</h3>
        <p className="mt-1 text-sm text-muted-foreground">{consequence}</p>
      </div>
      <Button
        variant="destructive"
        size="md"
        className="shrink-0"
        onClick={() => setConfirming(true)}
      >
        Leave organization
      </Button>

      <ConfirmDialog
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void leave()}
        title={`Leave ${organizationName}?`}
        message={consequence}
        confirmLabel="Leave organization"
        variant="danger"
        loading={leaving}
      />
    </Card>
  );
}
