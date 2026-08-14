import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/shared/utils/cn";
import { getBrowserTimeZone } from "@/shared/utils/timezone";

interface TimezoneSelectProps {
  /** Empty string = automatic (follows the browser/device zone). */
  value: string;
  onChange: (value: string) => void;
  /** Hides the empty-value entry for pickers that need a concrete zone. */
  allowAutomatic?: boolean;
  /** Copy for the empty value: names the entry row and the empty trigger. */
  automaticLabel?: string;
  /** Browser abbreviation + offset on the empty entry; fits "follow the browser" copy, not "not set". */
  showBrowserZoneHint?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

interface ZoneOption {
  zone: string;
  city: string;
  abbreviation: string;
  offset: string;
  region: string;
  searchText: string;
}

const REGION_ORDER = [
  "Africa",
  "America",
  "Antarctica",
  "Arctic",
  "Asia",
  "Atlantic",
  "Australia",
  "Europe",
  "Indian",
  "Pacific",
  "Other",
];

// Not in every engine yet, and the type only lands in newer TS libs.
function listTimeZones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    return supported ? supported("timeZone") : [];
  } catch {
    return [];
  }
}

function zoneOffset(zone: string, now: Date): string {
  try {
    return `UTC${formatInTimeZone(now, zone, "xxx")}`;
  } catch {
    return "";
  }
}

/** "EEST" / "PDT" where a name exists, "GMT+3"-style otherwise. */
function zoneAbbreviation(zone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function buildZoneOptions(now: Date): ZoneOption[] {
  return listTimeZones()
    .filter((zone) => zone !== "UTC")
    .map((zone) => {
      const segments = zone.split("/");
      const region = segments.length > 1 ? segments[0].replace(/_/g, " ") : "Other";
      const city =
        segments.length > 1
          ? segments.slice(1).join(" / ").replace(/_/g, " ")
          : zone.replace(/_/g, " ");
      const abbreviation = zoneAbbreviation(zone, now);
      return {
        zone,
        city,
        abbreviation,
        offset: zoneOffset(zone, now),
        region,
        searchText: `${zone} ${city} ${region} ${abbreviation}`.toLowerCase(),
      };
    });
}

interface ZoneRowProps {
  title: string;
  subtitle: string;
  offset: string;
  selected: boolean;
  onSelect: () => void;
}

function ZoneRow({ title, subtitle, offset, selected, onSelect }: ZoneRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
        selected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-medium">{title}</span>
        {subtitle && <span className="shrink-0 text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">{offset}</span>
        {selected && <Check size={14} weight="bold" className="text-primary" />}
      </span>
    </button>
  );
}

export function TimezoneSelect({
  value,
  onChange,
  allowAutomatic = true,
  automaticLabel = "Browser Time",
  showBrowserZoneHint = true,
  disabled = false,
  className,
  ariaLabel,
}: TimezoneSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const now = useMemo(() => new Date(), []);
  const browserZone = getBrowserTimeZone();
  const browserAbbreviation = useMemo(() => zoneAbbreviation(browserZone, now), [browserZone, now]);

  const zones = useMemo(() => buildZoneOptions(now), [now]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => z.searchText.includes(q));
  }, [zones, query]);

  const grouped = useMemo(() => {
    const byRegion = new Map<string, ZoneOption[]>();
    for (const option of filtered) {
      const list = byRegion.get(option.region);
      if (list) list.push(option);
      else byRegion.set(option.region, [option]);
    }
    return REGION_ORDER.filter((region) => byRegion.has(region)).map((region) => ({
      region,
      options: byRegion.get(region) as ZoneOption[],
    }));
  }, [filtered]);

  const utcMatchesQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return "utc gmt coordinated universal time".includes(q);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    searchRef.current?.focus();

    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 320);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const openUpward = window.innerHeight - rect.bottom < 320 && rect.top > 320;
      setPosition({
        top: openUpward ? undefined : rect.bottom + 4,
        bottom: openUpward ? window.innerHeight - rect.top + 4 : undefined,
        left,
        width,
      });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const triggerLabel = value ? value.replace(/_/g, " ") : automaticLabel;

  const select = (zone: string) => {
    onChange(zone);
    setQuery("");
    setIsOpen(false);
  };

  const renderDropdown = () => {
    if (!isOpen || !position) return null;

    const hasResults = utcMatchesQuery || grouped.length > 0 || (allowAutomatic && !query);

    const dropdown = (
      <div
        ref={dropdownRef}
        style={{
          position: "fixed",
          top: position.top,
          bottom: position.bottom,
          left: position.left,
          width: position.width,
        }}
        className={cn(
          "z-[200] overflow-hidden rounded-md",
          "border border-border bg-card shadow-xl",
          "animate-in fade-in-0 duration-100",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search timezones..."
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {allowAutomatic && !query && (
            <ZoneRow
              title={automaticLabel}
              subtitle={showBrowserZoneHint ? browserAbbreviation : ""}
              offset={showBrowserZoneHint ? zoneOffset(browserZone, now) : ""}
              selected={!value}
              onSelect={() => select("")}
            />
          )}
          {utcMatchesQuery && (
            <ZoneRow
              title="Coordinated Universal Time"
              subtitle="UTC, GMT"
              offset="UTC+00:00"
              selected={value === "UTC"}
              onSelect={() => select("UTC")}
            />
          )}
          {grouped.map(({ region, options }) => (
            <div key={region}>
              <div className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                {region}
              </div>
              {options.map((option) => (
                <ZoneRow
                  key={option.zone}
                  title={option.city}
                  subtitle={option.abbreviation}
                  offset={option.offset}
                  selected={option.zone === value}
                  onSelect={() => select(option.zone)}
                />
              ))}
            </div>
          ))}
          {!hasResults && (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No matching timezone
            </div>
          )}
        </div>
      </div>
    );

    return createPortal(dropdown, document.body);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-label={ariaLabel ?? "Timezone"}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background",
          "px-3 py-2 text-sm font-medium transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-background",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "hover:bg-muted/50",
        )}
      >
        <span className="truncate">{triggerLabel}</span>
        <CaretDown
          size={16}
          weight="bold"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {renderDropdown()}
    </div>
  );
}
