/** Composable filter sections combine with implicit AND semantics. Edits local criteria; the parent wires URL sync. */

import { useCallback, useState } from "react";
import {
  CaretDown,
  CaretRight,
  Tag as TagIcon,
  SquaresFour,
  User,
  At,
  CalendarPlus,
  ClockCounterClockwise,
  SlidersHorizontal,
  Plus,
  X,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { ContentType, AccessMode } from "@uniffy/proto/common/v1/common_pb";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { TagPicker } from "@/features/tags/components/TagPicker";
import { SubjectPicker, SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, type SelectOption } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import type { SerializedTagFilterCriteria } from "@/features/tags/store/tagsThunks";

interface FilterRailProps {
  criteria: SerializedTagFilterCriteria;
  onChange: (next: SerializedTagFilterCriteria) => void;
}

const DOMAIN_OPTIONS: Array<{ value: ContentType; label: string }> = [
  { value: ContentType.NOTE, label: "Notes" },
  { value: ContentType.FILE, label: "Files" },
  { value: ContentType.CALENDAR_EVENT, label: "Events" },
  { value: ContentType.CHAT, label: "Channels" },
  { value: ContentType.AGENT, label: "Agents" },
  { value: ContentType.PROJECT, label: "Projects" },
  { value: ContentType.TASK, label: "Tasks" },
];

const SOURCE_OPTIONS: Array<{ value: "manual" | "inline"; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "inline", label: "Inline" },
];

const ACCESS_OPTIONS: SelectOption<number>[] = [
  { value: -1, label: "Any" },
  { value: AccessMode.OWNER_ONLY, label: "Owner only" },
  { value: AccessMode.EXPLICIT_MEMBERS, label: "Members" },
  { value: AccessMode.OPEN_TO_ORG, label: "Open to org" },
];

function isoToCalendarValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function calendarValueToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toISOString();
}

export function FilterRail({ criteria, onChange }: FilterRailProps) {
  const currentUserId = useAppSelector((s) => s.auth.user?.id ?? null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    tags: true,
    domain: true,
    owner: true,
    source: false,
    created: false,
    updated: false,
    advanced: false,
  });

  const toggleSection = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const patch = useCallback(
    (partial: Partial<SerializedTagFilterCriteria>) => onChange({ ...criteria, ...partial }),
    [criteria, onChange],
  );

  const toggle = <T,>(arr: T[], value: T): T[] =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const advancedActive = (criteria.accessMode !== null ? 1 : 0) + (criteria.untaggedOnly ? 1 : 0);

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      <nav className="space-y-0.5">
        <Section
          id="tags"
          title="Tags"
          icon={TagIcon}
          activeCount={criteria.tagIds.length}
          isExpanded={expanded.tags}
          onToggle={toggleSection}
        >
          <TagPicker
            selectedTagIds={criteria.tagIds}
            onChange={(tagIds) => patch({ tagIds })}
            placeholder="Search tag..."
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Multiple tags match content carrying every selection (AND).
          </p>
        </Section>

        <Section
          id="domain"
          title="Domain"
          icon={SquaresFour}
          activeCount={criteria.contentTypes.length}
          isExpanded={expanded.domain}
          onToggle={toggleSection}
        >
          <ul className="space-y-2">
            {DOMAIN_OPTIONS.map((opt) => {
              const checked = criteria.contentTypes.includes(opt.value);
              return (
                <li key={opt.value}>
                  <Checkbox
                    label={opt.label}
                    checked={checked}
                    onChange={() =>
                      patch({
                        contentTypes: toggle(criteria.contentTypes, opt.value),
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </Section>

        <Section
          id="owner"
          title="Owner"
          icon={User}
          activeCount={criteria.ownerIds.length}
          isExpanded={expanded.owner}
          onToggle={toggleSection}
        >
          <OwnerFilter
            currentUserId={currentUserId}
            ownerIds={criteria.ownerIds}
            onChange={(ownerIds) => patch({ ownerIds })}
          />
        </Section>

        <Section
          id="source"
          title="Source"
          icon={At}
          activeCount={criteria.sources.length}
          isExpanded={expanded.source}
          onToggle={toggleSection}
        >
          <ul className="space-y-2">
            {SOURCE_OPTIONS.map((opt) => {
              const checked = criteria.sources.includes(opt.value);
              return (
                <li key={opt.value}>
                  <Checkbox
                    label={opt.label}
                    checked={checked}
                    onChange={() =>
                      patch({
                        sources: toggle(criteria.sources, opt.value),
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">Empty = both manual and inline.</p>
        </Section>

        <Section
          id="created"
          title="Created"
          icon={CalendarPlus}
          activeCount={(criteria.createdAfter ? 1 : 0) + (criteria.createdBefore ? 1 : 0)}
          isExpanded={expanded.created}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-2 gap-2">
            <DatePicker
              value={isoToCalendarValue(criteria.createdAfter)}
              onChange={(v) => patch({ createdAfter: calendarValueToIso(v) })}
              placeholder="From"
              className="text-xs"
            />
            <DatePicker
              value={isoToCalendarValue(criteria.createdBefore)}
              onChange={(v) => patch({ createdBefore: calendarValueToIso(v) })}
              placeholder="To"
              className="text-xs"
            />
          </div>
        </Section>

        <Section
          id="updated"
          title="Updated"
          icon={ClockCounterClockwise}
          activeCount={(criteria.updatedAfter ? 1 : 0) + (criteria.updatedBefore ? 1 : 0)}
          isExpanded={expanded.updated}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-2 gap-2">
            <DatePicker
              value={isoToCalendarValue(criteria.updatedAfter)}
              onChange={(v) => patch({ updatedAfter: calendarValueToIso(v) })}
              placeholder="From"
              className="text-xs"
            />
            <DatePicker
              value={isoToCalendarValue(criteria.updatedBefore)}
              onChange={(v) => patch({ updatedBefore: calendarValueToIso(v) })}
              placeholder="To"
              className="text-xs"
            />
          </div>
        </Section>

        <Section
          id="advanced"
          title="Advanced"
          icon={SlidersHorizontal}
          activeCount={advancedActive}
          isExpanded={expanded.advanced}
          onToggle={toggleSection}
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Access mode</label>
              <Select<number>
                value={criteria.accessMode ?? -1}
                onChange={(value) =>
                  patch({
                    accessMode: value === -1 ? null : (value as AccessMode),
                  })
                }
                options={ACCESS_OPTIONS}
                size="sm"
                className="w-full"
              />
            </div>
            <Checkbox
              label="Untagged content only"
              checked={criteria.untaggedOnly}
              onChange={(e) => patch({ untaggedOnly: e.target.checked })}
            />
          </div>
        </Section>
      </nav>
    </div>
  );
}

interface OwnerFilterProps {
  currentUserId: string | null;
  ownerIds: string[];
  onChange: (next: string[]) => void;
}

function OwnerFilter({ currentUserId, ownerIds, onChange }: OwnerFilterProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { subjects: resolvedOwners } = useSubjectResolver(ownerIds);

  const meSelected = currentUserId !== null && ownerIds.includes(currentUserId);

  const toggleMe = useCallback(() => {
    if (!currentUserId) return;
    onChange(
      meSelected ? ownerIds.filter((id) => id !== currentUserId) : [...ownerIds, currentUserId],
    );
  }, [currentUserId, meSelected, ownerIds, onChange]);

  const removeOwner = useCallback(
    (id: string) => {
      onChange(ownerIds.filter((x) => x !== id));
    },
    [ownerIds, onChange],
  );

  const handlePickerChange = useCallback(
    (ids: string[]) => {
      onChange(ids);
    },
    [onChange],
  );

  return (
    <div className="space-y-2">
      {currentUserId && (
        <button
          type="button"
          onClick={toggleMe}
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs transition-colors",
            meSelected
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Me
        </button>
      )}

      {resolvedOwners.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {resolvedOwners.map((subject) => (
            <span
              key={subject.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
            >
              <SubjectAvatar subject={subject} size="xs" />
              <span className="max-w-[120px] truncate">{subject.name}</span>
              <button
                type="button"
                onClick={() => removeOwner(subject.id)}
                className="rounded p-0.5 hover:bg-primary/20"
                aria-label={`Remove ${subject.name}`}
              >
                <X size={10} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs transition-colors",
            pickerOpen
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Plus size={12} weight="bold" />
          Add owner
        </button>
        {pickerOpen && (
          <SubjectPicker
            mode="multi"
            subjectTypes="users"
            value={ownerIds}
            onChange={handlePickerChange}
            placeholder="Filter by owner..."
            onClose={() => setPickerOpen(false)}
            autoFocus
          />
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  id: string;
  title: string;
  icon: Icon;
  activeCount: number;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}

function Section({
  id,
  title,
  icon: SectionIcon,
  activeCount,
  isExpanded,
  onToggle,
  children,
}: SectionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-accent transition-colors text-left group cursor-pointer"
      >
        {isExpanded ? (
          <CaretDown size={14} weight="bold" className="text-muted-foreground" />
        ) : (
          <CaretRight size={14} weight="bold" className="text-muted-foreground" />
        )}
        <SectionIcon size={16} weight="duotone" className="text-muted-foreground" />
        <span className="flex-1">{title}</span>
        {activeCount > 0 && (
          <span className="text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-primary/10 text-primary">
            {activeCount}
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="ml-4 pl-2 border-l border-border space-y-0.5 mt-0.5 mb-1 pr-1 py-1">
          {children}
        </div>
      )}
    </div>
  );
}
