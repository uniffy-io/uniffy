import type { RefObject } from "react";
import { Check } from "@phosphor-icons/react";
import { PortalMenu } from "@/components/ui/portal-menu";
import { cn } from "@/shared/utils/cn";
import { ScreenShareQuality } from "@uniffy/proto/calls/v1/calls_pb";
import {
  SCREEN_SHARE_QUALITY_LABEL,
  selectableTiers,
} from "@/features/calls/utils/screenShareQuality";

interface ScreenShareQualityMenuProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  /** Org-resolved ceiling; tiers above it are not offered. */
  cap: ScreenShareQuality;
  selected: ScreenShareQuality;
  onSelect: (quality: ScreenShareQuality) => void;
}

export function ScreenShareQualityMenu({
  open,
  onClose,
  triggerRef,
  cap,
  selected,
  onSelect,
}: ScreenShareQualityMenuProps) {
  const options = [ScreenShareQuality.UNSPECIFIED, ...selectableTiers(cap)];
  return (
    <PortalMenu open={open} onClose={onClose} triggerRef={triggerRef} className="w-56">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
        Screen share quality
      </div>
      {options.map((tier) => {
        const active = selected === tier;
        const label =
          tier === ScreenShareQuality.UNSPECIFIED ? "Auto" : SCREEN_SHARE_QUALITY_LABEL[tier];
        return (
          <button
            key={tier}
            type="button"
            onClick={() => {
              onSelect(tier);
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="w-4 shrink-0">{active && <Check size={14} />}</span>
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </PortalMenu>
  );
}
