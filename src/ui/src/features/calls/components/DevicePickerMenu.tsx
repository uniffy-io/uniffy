import type { RefObject } from "react";
import { Check } from "@phosphor-icons/react";
import { PortalMenu } from "@/components/ui/portal-menu";
import { cn } from "@/shared/utils/cn";

interface DevicePickerMenuProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  devices: MediaDeviceInfo[];
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  label: string;
}

export function DevicePickerMenu({
  open,
  onClose,
  triggerRef,
  devices,
  selectedId,
  onSelect,
  label,
}: DevicePickerMenuProps) {
  return (
    <PortalMenu open={open} onClose={onClose} triggerRef={triggerRef} className="w-64">
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {devices.length === 0 && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground">No devices found</div>
      )}
      {devices.map((device, i) => {
        const active = selectedId ? device.deviceId === selectedId : i === 0;
        return (
          <button
            key={device.deviceId || i}
            type="button"
            onClick={() => {
              onSelect(device.deviceId);
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="w-4 shrink-0">{active && <Check size={14} />}</span>
            <span className="truncate">{device.label || `Device ${i + 1}`}</span>
          </button>
        );
      })}
    </PortalMenu>
  );
}
