/** Chips and a regenerate menu on a generated image, driven by `tool_meta`. */

import { useState } from "react";
import { ArrowsClockwise, CaretDown, Image as ImageIcon } from "@phosphor-icons/react";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { useAppSelector } from "@/app/hooks";
import { runtimeApi } from "@/features/agents/api/runtimeApi";
import { friendlyErrorMessage } from "@/config";
import { toast } from "sonner";
import { formatImageCost } from "@/features/agents/utils/imageParams";
import type { ImageGenerationMeta } from "@/features/chat/utils/imageMeta";

const RATIO_PRESETS: { label: string; patch: Record<string, string> }[] = [
  { label: "Square (1:1)", patch: { aspect_ratio: "1:1" } },
  { label: "Landscape (16:9)", patch: { aspect_ratio: "16:9" } },
  { label: "Portrait (9:16)", patch: { aspect_ratio: "9:16" } },
];

const QUALITY_PRESETS: { label: string; patch: Record<string, string> }[] = [
  { label: "Higher resolution (2K)", patch: { resolution: "2K" } },
  { label: "Highest quality", patch: { quality: "high" } },
];

/** Only offer a change that would actually differ from what produced this image. */
const applicablePresets = (
  presets: { label: string; patch: Record<string, string> }[],
  params: Record<string, string>,
) =>
  presets.filter(({ patch }) =>
    Object.entries(patch).some(([key, value]) => params[key] !== value),
  );

export function GeneratedImageCard({
  meta,
  channelId,
  messageId,
}: {
  meta: ImageGenerationMeta;
  channelId: string;
  messageId: string;
}) {
  const organizationId = useAppSelector((s) => s.auth.currentOrganizationId ?? "");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const chips = [
    meta.params.aspect_ratio,
    meta.params.resolution,
    meta.params.quality,
    meta.cost !== null ? formatImageCost(String(meta.cost)) : null,
  ].filter((chip): chip is string => !!chip && chip !== "auto");

  const presets = [
    ...applicablePresets(RATIO_PRESETS, meta.params),
    ...applicablePresets(QUALITY_PRESETS, meta.params),
  ];

  const regenerate = async (patch: Record<string, string>) => {
    setOpen(false);
    setPending(true);
    try {
      await runtimeApi.regenerateImage({
        organizationId,
        channelId,
        messageId,
        paramsPatch: JSON.stringify(patch),
      });
    } catch (error) {
      const friendly = friendlyErrorMessage(error instanceof Error ? error.message : String(error));
      if (friendly) toast.error(friendly);
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-2"
      data-testid={`chat-generated-image-${messageId}`}
    >
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <ImageIcon size={12} className="opacity-70" />
        {chips.length > 0 ? chips.join(" · ") : meta.model}
      </span>
      {presets.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5",
              "text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
              pending && "opacity-50 cursor-not-allowed",
            )}
            data-testid={`chat-generated-image-regenerate-${messageId}`}
            data-state={open ? "open" : "closed"}
          >
            <ArrowsClockwise size={11} weight="bold" />
            {pending ? "Regenerating..." : "Regenerate with..."}
            <CaretDown size={9} />
          </button>
          {open && (
            <div
              className={cn(popoverShellClass, "absolute left-0 top-full z-50 mt-1 min-w-52 p-1")}
            >
              {presets.map(({ label, patch }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => void regenerate(patch)}
                  className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
