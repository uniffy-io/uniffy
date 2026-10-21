import { useCallback, useRef, useState } from "react";
import { CaretUpDown } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { getInitials } from "@/components/subject/utils";
import { OrganizationAvatar } from "@/features/auth/components/OrganizationList";
import { OrganizationSwitcherPopover } from "@/features/auth/components/OrganizationSwitcherPopover";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import {
  selectCurrentOrganization,
  selectOrganizationsStatus,
} from "@/features/auth/store/organizationsSlice";
import { fetchMyOrganizations } from "@/features/auth/store/organizationsThunks";
import { cn } from "@/shared/utils/cn";

const boxClass = "relative z-10 w-7 h-7 rounded-md border transition-colors duration-200";

/** Current organization in the header; opens the organization switcher. */
export function OrgIdentity() {
  const dispatch = useAppDispatch();
  const currentOrganization = useAppSelector(selectCurrentOrganization);
  const currentSlug = useAppSelector((state) => state.auth.currentOrganizationSlug);
  const status = useAppSelector(selectOrganizationsStatus);
  const { requestSwitch, confirmDialog } = useSwitchOrganization();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setIsOpen(false), []);

  // The slug stands in until the list names the organization.
  const label = currentOrganization?.name || currentSlug;
  if (!label) return null;

  const toggle = () => {
    if (!isOpen && status === "error") void dispatch(fetchMyOrganizations());
    setIsOpen((open) => !open);
  };

  const handleSelect = (slug: string) => {
    setIsOpen(false);
    void requestSwitch(slug);
  };

  const edgeClass = isOpen
    ? "border-primary/30"
    : "border-border-nav group-hover:border-primary/30";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={label}
        aria-label={`Organization: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={toggle}
        className="group relative flex min-w-0 max-w-full items-center gap-1.5 p-2 md:p-1.5 rounded-lg text-sm transition-colors focus-ring"
      >
        {currentOrganization ? (
          <OrganizationAvatar
            name={currentOrganization.name}
            className={cn(boxClass, "text-[10px]", edgeClass)}
          />
        ) : (
          <span
            aria-hidden="true"
            className={cn(
              boxClass,
              "flex shrink-0 items-center justify-center text-[10px] font-semibold text-muted-foreground",
              edgeClass,
            )}
          >
            {getInitials(label)}
          </span>
        )}
        <span
          className={cn(
            "hidden xl:inline text-sm font-medium truncate max-w-[10rem]",
            isOpen ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          {label}
        </span>
        <CaretUpDown
          size={12}
          weight="bold"
          aria-hidden="true"
          className="hidden xl:block shrink-0 text-muted-foreground"
        />
      </button>

      <OrganizationSwitcherPopover
        open={isOpen}
        onClose={close}
        triggerRef={triggerRef}
        onSelect={handleSelect}
      />
      {confirmDialog}
    </>
  );
}
