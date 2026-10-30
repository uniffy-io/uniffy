import { ArrowSquareOut } from "@phosphor-icons/react";
import { useCall } from "@/features/calls/components/callContext";
import { callControlClass } from "@/features/calls/components/controlChrome";

export function CallPopoutButton() {
  const { openPopout, popoutWindow } = useCall();
  return (
    <button
      type="button"
      onClick={() => void openPopout()}
      className={callControlClass(true)}
      aria-label={popoutWindow ? "Focus call window" : "Pop out call"}
      title="Pop out call"
    >
      <ArrowSquareOut size={16} />
    </button>
  );
}
