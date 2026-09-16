import type { ReactNode } from "react";
import { useComposeDockRef } from "@/features/chat/hooks/useComposeDockRef";

interface ComposeDockProps {
  children: ReactNode;
  testId?: string;
  centered?: boolean;
}

/** Keeps the composer mounted as an empty agent DM becomes a scrolling conversation. */
export function ComposeDock({ children, testId, centered = false }: ComposeDockProps) {
  const dockRef = useComposeDockRef();
  return (
    <div
      ref={dockRef}
      className={
        centered ? "relative hero-enter w-full max-w-2xl" : "absolute inset-x-0 bottom-0 z-20"
      }
      style={centered ? { animationDelay: "280ms", animationFillMode: "backwards" } : undefined}
      data-testid={testId}
    >
      {!centered && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface/80 to-surface/30 backdrop-blur-md"
        />
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
