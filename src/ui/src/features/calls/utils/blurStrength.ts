export type BlurStrength = "light" | "medium" | "strong";

export const DEFAULT_BLUR_STRENGTH: BlurStrength = "strong";

export const BLUR_STRENGTH_OPTIONS: { value: BlurStrength; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "strong", label: "Strong" },
];

// Full-frame pixels. The processor blurs a quarter-size copy with its kernel capped at 16 texels,
// so 64 already reaches the widest smear and larger values only flatten the kernel.
const BLUR_RADIUS: Record<BlurStrength, number> = { light: 24, medium: 40, strong: 80 };

let active: BlurStrength = DEFAULT_BLUR_STRENGTH;

/** Running blur processors read this every frame, so a change lands without restarting the camera. */
export function setActiveBlurStrength(strength: BlurStrength) {
  active = strength;
}

export function activeBlurRadius(): number {
  return BLUR_RADIUS[active];
}
