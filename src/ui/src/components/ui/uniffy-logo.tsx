import { cn } from '@/shared/utils/cn';

interface UniffyLogoProps {
  className?: string;
}

/** The Uniffy brand mark - a colored cube that reads on any background. */
export function UniffyLogo({ className }: UniffyLogoProps) {
  return (
    <img
      src="/uniffy-symbol.png"
      alt="Uniffy"
      className={cn('select-none', className)}
    />
  );
}
