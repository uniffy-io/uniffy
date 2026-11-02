import { SegmentedControl } from "@/components/ui/segmented-control";
import { BLUR_STRENGTH_OPTIONS, type BlurStrength } from "@/features/calls/utils/blurStrength";

export function BlurStrengthControl({
  value,
  onChange,
  className,
}: {
  value: BlurStrength;
  onChange: (value: BlurStrength) => void;
  className?: string;
}) {
  return (
    <SegmentedControl<BlurStrength>
      value={value}
      onChange={onChange}
      ariaLabel="Blur strength"
      className={className}
      options={BLUR_STRENGTH_OPTIONS.map(({ value: option, label }) => ({
        value: option,
        content: <span className="px-2 text-xs">{label}</span>,
      }))}
    />
  );
}
