import {
  estimateImageCost,
  formatImageCost,
  type ImagePriceEstimates,
} from "@/features/agents/utils/imageParams";
import type { ModelParamValues } from "@/features/agents/utils/modelParamsSchema";

/**
 * Per-image price for the current knob selection. Resolution and quality swing
 * cost by more than an order of magnitude, so the number belongs next to the
 * control rather than in a docs page.
 */
export function ImageCostHint({
  estimates,
  values,
}: {
  estimates: ImagePriceEstimates;
  values: ModelParamValues;
}) {
  const cost = estimateImageCost(estimates, values);
  if (!cost) return null;
  return (
    <p
      className="mt-1 text-[11px] text-muted-foreground tabular-nums"
      data-testid="image-cost-hint"
    >
      {formatImageCost(cost)} per image
    </p>
  );
}
