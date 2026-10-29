import { ArrowSquareOut } from "@phosphor-icons/react";
import { useCall } from "@/features/calls/components/callContext";

export function CallPopoutButton() {
  const { openPopout, popoutWindow } = useCall();
  return (
    <button
      type="button"
      onClick={() => void openPopout()}
      className="flex h-11 w-11 items-center justify-center rounded text-muted-foreground hover:bg-muted"
      aria-label={popoutWindow ? "Focus call window" : "Pop out call"}
      title="Pop out call"
    >
      <ArrowSquareOut size={18} />
    </button>
  );
}
