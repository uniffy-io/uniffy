import { useEffect, useRef, type Ref } from "react";
import type { OrbitScene } from "@/components/orbit/engine";
import { OrbitPanel } from "@/components/orbit/OrbitPanel";
import "@/components/orbit/orbit.css";

interface OrbitPageProps {
  header: React.ReactNode;
  scene: OrbitScene;
  orbitCaption?: React.ReactNode;
  orbitRef?: Ref<HTMLDivElement>;
  launching: boolean;
  /** Changing it scrolls the content column back to the top. */
  scrollKey?: string | null;
  children: React.ReactNode;
}

/**
 * Full-screen page for the moments around an organization: picking one and setting one up.
 * Content on the left, the orbit framed on the right; below lg the orbit becomes a band on top.
 */
export function OrbitPage({
  header,
  scene,
  orbitCaption,
  orbitRef,
  launching,
  scrollKey,
  children,
}: OrbitPageProps) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  return (
    <div
      className="orbit-page fixed inset-0 flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-launching={launching ? "true" : undefined}
    >
      <div className="orbit-wash pointer-events-none absolute inset-0" aria-hidden />
      <header className="orbit-fade relative z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border-strong px-4 md:px-6">
        {header}
      </header>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col lg:flex-row">
        <main
          ref={mainRef}
          className="orbit-fade order-last min-h-0 flex-1 overflow-y-auto lg:order-first"
        >
          {children}
        </main>
        <aside className="h-40 shrink-0 px-4 pt-4 md:h-48 md:px-6 lg:h-auto lg:w-[42%] lg:max-w-[640px] lg:py-6 lg:pl-0 lg:pr-6">
          <OrbitPanel ref={orbitRef} scene={scene} caption={orbitCaption} className="h-full" />
        </aside>
      </div>
    </div>
  );
}
