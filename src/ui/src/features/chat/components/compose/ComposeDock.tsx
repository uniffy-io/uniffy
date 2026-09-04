import type { ReactNode } from "react";
import { useComposeDockRef } from "@/features/chat/hooks/useComposeDockRef";

interface ComposeDockProps {
  children: ReactNode;
  testId?: string;
}

/**
 * Floating home for a composer at the bottom of a message stream. The stream
 * scrolls on beneath it; a blurred backdrop covers exactly the dock's box, so
 * content dissolves only once it passes under the card, and the area above it
 * stays untouched.
 */
export function ComposeDock({ children, testId }: ComposeDockProps) {
  const dockRef = useComposeDockRef();
  return (
    <div ref={dockRef} className="absolute inset-x-0 bottom-0 z-20" data-testid={testId}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/80 to-surface/30 backdrop-blur-md"
      />
      <div className="relative">{children}</div>
    </div>
  );
}
