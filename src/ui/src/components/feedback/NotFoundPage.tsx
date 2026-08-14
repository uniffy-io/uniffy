import { useNavigate } from "react-router-dom";
import { House, ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";

interface NotFoundPageProps {
  className?: string;
  heading?: string;
  description?: string;
  compact?: boolean;
}

export function NotFoundPage({
  className,
  heading = "Page not found",
  description = "The page you are looking for does not exist or has been moved. Check the URL or navigate back to familiar territory.",
  compact = false,
}: NotFoundPageProps) {
  useDocumentTitle("Page Not Found");
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden bg-background px-4",
        compact ? "min-h-[60vh]" : "min-h-dvh",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute top-[12%] left-[8%] h-32 w-32 rounded-full bg-primary/10 blur-sm animate-[drift-1_24s_ease-in-out_infinite]" />
        <div className="absolute top-[60%] right-[6%] h-40 w-40 rounded-3xl bg-primary/[0.12] blur-sm animate-[drift-2_28s_ease-in-out_infinite]" />

        <div className="absolute top-[20%] right-[18%] h-16 w-16 rounded-xl bg-primary/15 rotate-12 animate-[drift-3_18s_ease-in-out_infinite]" />
        <div className="absolute bottom-[22%] left-[14%] h-20 w-20 rounded-full bg-primary/[0.12] animate-[drift-1_22s_ease-in-out_infinite_reverse]" />
        <div className="absolute top-[45%] left-[5%] h-12 w-12 rounded-lg bg-primary/[0.18] -rotate-6 animate-[drift-2_16s_ease-in-out_infinite]" />

        <div className="absolute top-[30%] right-[32%] h-6 w-6 rounded-md bg-primary/20 rotate-45 animate-[drift-3_14s_ease-in-out_infinite]" />
        <div className="absolute bottom-[35%] right-[24%] h-8 w-8 rounded-full bg-primary/[0.18] animate-[drift-1_12s_ease-in-out_infinite]" />
        <div className="absolute top-[68%] left-[28%] h-5 w-5 rounded-sm bg-primary/[0.22] -rotate-12 animate-[drift-2_10s_ease-in-out_infinite_reverse]" />

        <div className="absolute top-[38%] left-[20%] h-px w-24 bg-gradient-to-r from-transparent via-primary/30 to-transparent -rotate-12 animate-[drift-3_20s_ease-in-out_infinite]" />
        <div className="absolute bottom-[40%] right-[16%] h-px w-32 bg-gradient-to-r from-transparent via-primary/25 to-transparent rotate-6 animate-[drift-1_26s_ease-in-out_infinite_reverse]" />

        <div className="absolute top-[15%] right-[10%] h-24 w-24 rounded-full border border-primary/[0.12] animate-[drift-2_30s_ease-in-out_infinite]" />
        <div className="absolute bottom-[18%] left-[22%] h-14 w-14 rounded-full border border-primary/10 animate-[drift-3_20s_ease-in-out_infinite_reverse]" />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center">
        <div
          className="select-none text-[8rem] leading-none font-black tracking-tighter text-primary/25 sm:text-[12rem] lg:text-[16rem]"
          aria-hidden="true"
        >
          404
        </div>

        <div className="-mt-12 sm:-mt-16 lg:-mt-20">
          <div className="mx-auto mb-5 h-1 w-12 rounded-full bg-primary/40" />

          <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {heading}
          </h1>

          <p className="mx-auto mb-8 max-w-sm text-sm leading-relaxed text-muted-foreground sm:max-w-md sm:text-base">
            {description}
          </p>

          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" size="md" onClick={() => window.history.back()}>
              <ArrowLeft size={16} weight="bold" />
              Go Back
            </Button>
            <Button variant="default" size="md" onClick={() => navigate("/")}>
              <House size={16} weight="bold" />
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes drift-1 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(12px, -18px) rotate(3deg); }
          50% { transform: translate(-8px, -28px) rotate(-2deg); }
          75% { transform: translate(16px, -10px) rotate(4deg); }
        }
        @keyframes drift-2 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(-16px, 14px) rotate(-4deg); }
          50% { transform: translate(10px, 24px) rotate(2deg); }
          75% { transform: translate(-12px, 8px) rotate(-3deg); }
        }
        @keyframes drift-3 {
          0%, 100% { transform: translate(0, 0) rotate(0deg); }
          33% { transform: translate(20px, -12px) rotate(5deg); }
          66% { transform: translate(-14px, 16px) rotate(-3deg); }
        }
      `}</style>
    </div>
  );
}
