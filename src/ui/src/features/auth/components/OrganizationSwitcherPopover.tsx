import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { Buildings, CircleNotch } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { popoverEnterClass } from "@/components/ui/popover";
import { PortalMenu } from "@/components/ui/portal-menu";
import { OrganizationList } from "@/features/auth/components/OrganizationList";
import {
  selectOrganizations,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import { cn } from "@/shared/utils/cn";

interface OrganizationSwitcherPopoverProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  onSelect: (slug: string) => void;
}

export function OrganizationSwitcherPopover({
  open,
  onClose,
  triggerRef,
  onSelect,
}: OrganizationSwitcherPopoverProps) {
  const organizations = useAppSelector(selectOrganizations);
  const status = useAppSelector(selectOrganizationsStatus);
  const currentOrganizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const switchingSlug = useAppSelector((state) => state.organizations.switchingSlug);

  return (
    <PortalMenu
      open={open}
      onClose={onClose}
      triggerRef={triggerRef}
      align="left"
      className={cn("w-72 py-0", popoverEnterClass)}
    >
      <div role="dialog" aria-label="Switch organization">
        <div className="py-1.5 px-1.5">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Organizations
          </div>
          {organizations.length > 0 ? (
            <div className="max-h-[min(20rem,50dvh)] overflow-y-auto">
              <OrganizationList
                organizations={organizations}
                currentOrganizationId={currentOrganizationId}
                switchingSlug={switchingSlug}
                onSelect={onSelect}
              />
            </div>
          ) : status === "error" ? (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">
              Organizations could not be loaded.
            </p>
          ) : (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
              <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" />
              Loading organizations...
            </p>
          )}
        </div>

        <div className="border-t border-border/60 py-1.5 px-1.5">
          <Link
            to="/select-org"
            onClick={onClose}
            className="group relative flex w-full min-h-11 md:min-h-0 items-center gap-2.5 px-2.5 py-2 text-sm rounded-md text-foreground/80 hover:text-foreground transition-colors overflow-hidden focus-ring"
          >
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 rounded-full bg-primary transition-all duration-300 ease-out group-hover:w-1/2 opacity-0 group-hover:opacity-70" />
            <Buildings
              size={16}
              weight="duotone"
              className="text-muted-foreground group-hover:text-primary transition-colors duration-200"
            />
            <span>All organizations</span>
          </Link>
        </div>
      </div>
    </PortalMenu>
  );
}
