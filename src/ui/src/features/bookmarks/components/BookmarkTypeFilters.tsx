import { BookmarkSimple } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { getContentTypeConfig } from "@/config/theme/contentTypes";
import { getUrnTypeBrandStops } from "@/config/theme/urnColors";
import { BOOKMARK_FILTER_TYPES } from "@/features/bookmarks/utils/bookmarkTypes";
import type { UrnType } from "@/shared/utils/urnTypes";

interface BookmarkTypeFiltersProps {
  selected: UrnType[];
  onChange: (types: UrnType[]) => void;
  /** Ribbon set to offer; defaults to the bookmarkable types. */
  types?: UrnType[];
  /** "top" hangs the ribbons from the page top; "side" pins them to a left spine. */
  orientation?: "top" | "side";
}

interface RibbonProps {
  active: boolean;
  color: string;
  label: string;
  icon: React.ReactNode;
  delay: number;
  onClick: () => void;
  testId: string;
}

function Ribbon({ active, color, label, icon, delay, onClick, testId }: RibbonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className="group/ribbon flex shrink-0 snap-start flex-col items-center gap-1.5 outline-none"
    >
      <span
        className={cn(
          "bookmark-ribbon flex w-10 items-end justify-center pb-3.5",
          "transition-all duration-300 ease-out",
          "group-focus-visible/ribbon:ring-2 group-focus-visible/ribbon:ring-ring",
          active ? "h-16" : "h-11 group-hover/ribbon:h-[3.25rem]",
        )}
        style={{
          animationDelay: `${delay}ms`,
          backgroundColor: active ? color : `color-mix(in srgb, ${color} 16%, transparent)`,
          color: active ? "hsl(var(--primary-foreground))" : color,
          boxShadow: active
            ? `0 10px 22px -8px color-mix(in srgb, ${color} 55%, transparent)`
            : "none",
        }}
      >
        {icon}
      </span>
      <span
        className={cn(
          "text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors",
          !active && "text-muted-foreground/70 group-hover/ribbon:text-muted-foreground",
        )}
        style={active ? { color } : undefined}
      >
        {label}
      </span>
    </button>
  );
}

function SideRibbon({ active, color, label, icon, delay, onClick, testId }: RibbonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className="group/ribbon flex w-full outline-none"
    >
      <span
        className={cn(
          "bookmark-ribbon-side flex h-8 items-center gap-2 pl-3 pr-5",
          "text-[10px] font-semibold uppercase tracking-[0.12em]",
          "transition-all duration-300 ease-out",
          "group-focus-visible/ribbon:ring-2 group-focus-visible/ribbon:ring-ring",
          active ? "w-full" : "w-[calc(100%-1.5rem)] group-hover/ribbon:w-[calc(100%-0.625rem)]",
        )}
        style={{
          animationDelay: `${delay}ms`,
          backgroundColor: active ? color : `color-mix(in srgb, ${color} 16%, transparent)`,
          color: active ? "hsl(var(--primary-foreground))" : color,
          boxShadow: active
            ? `8px 6px 20px -10px color-mix(in srgb, ${color} 55%, transparent)`
            : "none",
        }}
      >
        {icon}
        <span className="truncate">{label}</span>
      </span>
    </button>
  );
}

export function BookmarkTypeFilters({
  selected,
  onChange,
  types = BOOKMARK_FILTER_TYPES,
  orientation = "top",
}: BookmarkTypeFiltersProps) {
  const toggleType = (type: UrnType) => {
    onChange(selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type]);
  };

  const RibbonVariant = orientation === "side" ? SideRibbon : Ribbon;

  return (
    <div
      className={cn(
        orientation === "side"
          ? "relative flex flex-col gap-1.5 border-l border-border/60 pl-0"
          : [
              "flex items-start gap-2.5 overflow-x-auto snap-x pb-1",
              "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            ],
      )}
      role="group"
      aria-label="Filter bookmarks by type"
    >
      <RibbonVariant
        active={selected.length === 0}
        color="hsl(var(--primary))"
        label="All"
        icon={<BookmarkSimple size={14} weight={selected.length === 0 ? "fill" : "duotone"} />}
        delay={0}
        onClick={() => onChange([])}
        testId="bookmark-filter-all"
      />
      {types.map((type, index) => {
        const config = getContentTypeConfig(type);
        const TypeIcon = config.icon;
        const active = selected.includes(type);
        return (
          <RibbonVariant
            key={type}
            active={active}
            color={getUrnTypeBrandStops(type).start}
            label={config.labelPlural}
            icon={<TypeIcon size={14} weight="duotone" />}
            delay={(index + 1) * 35}
            onClick={() => toggleType(type)}
            testId={`bookmark-filter-${type}`}
          />
        );
      })}
    </div>
  );
}
