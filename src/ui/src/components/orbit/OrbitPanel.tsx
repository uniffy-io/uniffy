import type { Ref } from "react";
import type { OrbitScene } from "@/components/orbit/engine";
import { useOrbit } from "@/components/orbit/useOrbit";
import { cn } from "@/shared/utils/cn";

interface OrbitPanelProps {
  scene: OrbitScene;
  /** A short label pinned in the corner, naming what the orbit shows. */
  caption?: React.ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}

/** The orbit framed as a surface card; its chrome fades on launch so only the hub remains. */
export function OrbitPanel({ scene, caption, className, ref }: OrbitPanelProps) {
  const canvasRef = useOrbit(scene);
  return (
    <div ref={ref} className={cn("relative", className)} aria-hidden>
      <div className="orbit-chrome absolute inset-0 rounded-2xl bg-surface shadow-edge" />
      <div className="orbit-dots absolute inset-0 rounded-2xl" />
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
      {caption && (
        <div className="orbit-chrome absolute left-4 top-3.5 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
          {caption}
        </div>
      )}
    </div>
  );
}
