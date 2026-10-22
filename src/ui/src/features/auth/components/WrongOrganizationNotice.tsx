import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { OrganizationAvatar } from "@/features/auth/components/OrganizationList";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import type { ContentOrganization } from "@/features/auth/store/organizationsThunks";
import { cn } from "@/shared/utils/cn";
import { getUrnTypeLabel } from "@/shared/utils/urn";

interface WrongOrganizationNoticeProps {
  urn: string;
  organization: Pick<ContentOrganization, "name" | "slug">;
  /** Where the switch lands, normally the address that failed to open. */
  path: string;
  onDismiss: () => void;
  /** `card` on a content sheet, `surface` on the app frame. */
  tone?: "card" | "surface";
  className?: string;
}

/** Offers to move this tab into the organization that holds an item the current one cannot open. */
export function WrongOrganizationNotice({
  urn,
  organization,
  path,
  onDismiss,
  tone = "surface",
  className,
}: WrongOrganizationNoticeProps) {
  const { requestSwitch, isSwitching, confirmDialog } = useSwitchOrganization();
  const label = getUrnTypeLabel(urn).toLowerCase();

  return (
    <div className={cn("flex h-full w-full items-center justify-center p-6", className)}>
      <Card tone={tone} className="w-full max-w-md p-8 text-center">
        <OrganizationAvatar
          name={organization.name}
          className="mx-auto mb-4 h-12 w-12 rounded-xl text-base"
        />
        <h2 className="mb-1 break-words text-base font-medium text-foreground">
          This {label} is in {organization.name}.
        </h2>
        <p className="mb-6 break-words text-sm text-muted-foreground">
          Switching moves this tab to {organization.name}. Your other tabs stay where they are.
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <Button variant="ghost" size="md" onClick={onDismiss} disabled={isSwitching}>
            Stay here
          </Button>
          <Button
            size="md"
            className="min-w-0 max-w-full"
            loading={isSwitching}
            title={`Switch to ${organization.name} and open`}
            onClick={() => void requestSwitch(organization.slug, path)}
          >
            <span className="truncate">Switch to {organization.name} and open</span>
          </Button>
        </div>
      </Card>
      {confirmDialog}
    </div>
  );
}
