import { useEffect, useState } from "react";
import { Check, LockSimple, Plus, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { friendlyErrorMessage } from "@/config";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TimezoneSelect } from "@/components/ui/timezone-select";
import { getEffectiveTimeZone } from "@/shared/utils/timezone";
import { updateUser } from "@/features/auth/store/authSlice";
import { usersApi } from "@/features/settings/api/usersApi";
import { formatDateFull } from "@/shared/utils/dateFormatting";
import {
  fetchPersonThunk,
  updateMyProfileThunk,
  type MyProfileChanges,
  type SerializedPersonProfile,
  type SerializedProfileLink,
} from "@/features/people/store/peopleThunks";

const MAX_LINKS = 10;
const BIO_MAX = 2000;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Leap-safe: February keeps 29 so a Feb 29 birthday stays selectable.
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad2 = (value: number): string => String(value).padStart(2, "0");

function ManagedHint() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <LockSimple size={11} weight="fill" />
      Synced from directory
    </span>
  );
}

function Field({
  label,
  htmlFor,
  managed,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  managed?: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {managed && <ManagedHint />}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-xs font-medium text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReadOnlyFacts({ person }: { person: SerializedPersonProfile }) {
  const facts: { label: string; value: string }[] = [];
  if (person.jobTitle) facts.push({ label: "Job title", value: person.jobTitle });
  if (person.department) facts.push({ label: "Department", value: person.department });
  if (person.officeLocation) facts.push({ label: "Office", value: person.officeLocation });
  if (person.startDateMs !== null) {
    facts.push({
      label: "Start date",
      value: formatDateFull(new Date(person.startDateMs).toISOString().slice(0, 10)),
    });
  }
  if (facts.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs font-medium text-muted-foreground">{fact.label}</dt>
            <dd className="truncate text-sm font-medium text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BirthdayField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const month = value.slice(0, 2);
  const day = value.slice(3, 5);
  const monthIndex = month ? Number(month) - 1 : -1;

  const monthOptions: SelectOption<string>[] = [
    { value: "", label: "Not set" },
    ...MONTHS.map((name, index) => ({ value: pad2(index + 1), label: name })),
  ];

  const dayCount = monthIndex >= 0 ? DAYS_IN_MONTH[monthIndex] : 31;
  const dayOptions: SelectOption<string>[] = Array.from({ length: dayCount }, (_, index) => ({
    value: pad2(index + 1),
    label: String(index + 1),
  }));

  return (
    <div className="flex items-center gap-2">
      <Select<string>
        value={month}
        onChange={(next) => {
          if (!next) {
            onChange("");
            return;
          }
          // A day past the new month's end would fail validation.
          const maxDay = DAYS_IN_MONTH[Number(next) - 1];
          const nextDay = day && Number(day) <= maxDay ? day : "01";
          onChange(`${next}-${nextDay}`);
        }}
        options={monthOptions}
        placeholder="Not set"
        disabled={disabled}
        className="flex-1"
        triggerClassName="w-full h-10"
        menuMinWidth={160}
        ariaLabel="Birthday month"
      />
      <Select<string>
        value={day}
        onChange={(next) => onChange(`${month || "01"}-${next}`)}
        options={dayOptions}
        placeholder="Day"
        disabled={disabled || !month}
        triggerClassName="w-24 h-10"
        menuMinWidth={90}
        ariaLabel="Birthday day"
      />
    </div>
  );
}

function LinksField({
  links,
  onChange,
  disabled,
}: {
  links: SerializedProfileLink[];
  onChange: (links: SerializedProfileLink[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      {links.map((link, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={link.label}
            onChange={(e) =>
              onChange(links.map((l, i) => (i === index ? { ...l, label: e.target.value } : l)))
            }
            disabled={disabled}
            placeholder="Label"
            maxLength={60}
            aria-label={`Link ${index + 1} label`}
            className="w-40 shrink-0"
          />
          <Input
            value={link.url}
            onChange={(e) =>
              onChange(links.map((l, i) => (i === index ? { ...l, url: e.target.value } : l)))
            }
            disabled={disabled}
            placeholder="https://..."
            maxLength={500}
            aria-label={`Link ${index + 1} URL`}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(links.filter((_, i) => i !== index))}
            disabled={disabled}
            aria-label={`Remove link ${index + 1}`}
          >
            <X size={14} weight="bold" />
          </Button>
        </div>
      ))}
      {links.length < MAX_LINKS && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange([...links, { label: "", url: "" }])}
          className="text-primary"
        >
          <Plus size={14} weight="bold" />
          Add link
        </Button>
      )}
    </div>
  );
}

interface ProfileFormProps {
  person: SerializedPersonProfile;
  initialPronouns: string;
}

function ProfileForm({ person, initialPronouns }: ProfileFormProps) {
  const dispatch = useAppDispatch();

  const [pronouns, setPronouns] = useState(initialPronouns);
  const [workPhone, setWorkPhone] = useState(person.workPhone ?? "");
  const [mobilePhone, setMobilePhone] = useState(person.mobilePhone ?? "");
  const [timezone, setTimezone] = useState(person.timezone ?? "");
  const [birthday, setBirthday] = useState(person.birthday ?? "");
  const [bio, setBio] = useState(person.bio ?? "");
  const [links, setLinks] = useState<SerializedProfileLink[]>(person.links);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isManaged = (field: string) => person.managedFields.includes(field);

  const cleanLinks = links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.url);
  const linksDirty = JSON.stringify(cleanLinks) !== JSON.stringify(person.links);
  const pronounsDirty = pronouns.trim() !== initialPronouns;

  const changes: MyProfileChanges = {};
  if (workPhone.trim() !== (person.workPhone ?? "")) changes.workPhone = workPhone.trim();
  if (mobilePhone.trim() !== (person.mobilePhone ?? "")) changes.mobilePhone = mobilePhone.trim();
  if (timezone.trim() !== (person.timezone ?? "")) changes.timezone = timezone.trim();
  if (birthday !== (person.birthday ?? "")) changes.birthday = birthday;
  if (bio.trim() !== (person.bio ?? "")) changes.bio = bio.trim();
  if (linksDirty) changes.links = cleanLinks;

  const isDirty = pronounsDirty || Object.keys(changes).length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty || saving) return;

    setSaving(true);
    try {
      if (pronounsDirty) {
        const profile = await usersApi.updateMyProfile({ pronouns: pronouns.trim() });
        dispatch(updateUser({ pronouns: profile.pronouns ?? "" }));
      }
      if (Object.keys(changes).length > 0) {
        await dispatch(updateMyProfileThunk(changes)).unwrap();
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      // Thunk rejections already toast; the pronouns call is a bare RPC.
      if (pronounsDirty) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(friendlyErrorMessage(message) ?? "Could not save your profile");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card tone="surface" className="space-y-5 p-4 md:p-6">
        <ReadOnlyFacts person={person} />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Pronouns" htmlFor="profile-pronouns">
            <Input
              id="profile-pronouns"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              maxLength={50}
              placeholder="e.g. she/her"
            />
          </Field>

          <Field label="Time zone" htmlFor="profile-timezone" managed={isManaged("timezone")}>
            <div className="flex items-center gap-2">
              <TimezoneSelect
                value={timezone}
                onChange={setTimezone}
                automaticLabel="Not set"
                showBrowserZoneHint={false}
                disabled={isManaged("timezone")}
                className="flex-1"
                ariaLabel="Profile time zone"
              />
              <Button
                type="button"
                variant="outline"
                size="md"
                className="shrink-0"
                disabled={isManaged("timezone")}
                onClick={() => setTimezone(getEffectiveTimeZone())}
              >
                Use current
              </Button>
            </div>
          </Field>

          <Field label="Work phone" htmlFor="profile-work-phone" managed={isManaged("work_phone")}>
            <Input
              id="profile-work-phone"
              type="tel"
              value={workPhone}
              onChange={(e) => setWorkPhone(e.target.value)}
              disabled={isManaged("work_phone")}
              maxLength={40}
              placeholder="+359 2 000 0000"
            />
          </Field>

          <Field
            label="Mobile phone"
            htmlFor="profile-mobile-phone"
            managed={isManaged("mobile_phone")}
          >
            <Input
              id="profile-mobile-phone"
              type="tel"
              value={mobilePhone}
              onChange={(e) => setMobilePhone(e.target.value)}
              disabled={isManaged("mobile_phone")}
              maxLength={40}
              placeholder="+359 888 000 000"
            />
          </Field>

          <Field
            label="Birthday"
            managed={isManaged("birthday")}
            hint="Day and month only, so teammates can celebrate without sharing your age."
          >
            <BirthdayField
              value={birthday}
              onChange={setBirthday}
              disabled={isManaged("birthday")}
            />
          </Field>
        </div>

        <Field label="Bio" htmlFor="profile-bio" managed={isManaged("bio")}>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            disabled={isManaged("bio")}
            rows={3}
            maxLength={BIO_MAX}
            placeholder="A few words about what you work on..."
          />
          <p className="mt-1.5 text-right text-xs font-medium text-muted-foreground">
            {bio.length} / {BIO_MAX}
          </p>
        </Field>

        <Field
          label="Links"
          managed={isManaged("links")}
          hint={`Up to ${MAX_LINKS} links shown on your profile.`}
        >
          <LinksField links={links} onChange={setLinks} disabled={isManaged("links")} />
        </Field>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" size="md" disabled={!isDirty} loading={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
            <Check size={16} weight="bold" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

export function ProfileFieldsSection() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((s) => s.auth.user?.id);
  const pronouns = useAppSelector((s) => s.auth.user?.pronouns ?? "");
  const person = useAppSelector((s) => (userId ? s.people.profilesById[userId] : undefined));

  useEffect(() => {
    if (userId) dispatch(fetchPersonThunk({ userId }));
  }, [dispatch, userId]);

  if (!person) return null;

  // Remounting on every server-side change is what resets the drafts after a
  // save; there is no effect syncing props into state.
  const revision = JSON.stringify([
    person.workPhone,
    person.mobilePhone,
    person.timezone,
    person.birthday,
    person.bio,
    person.links,
    person.managedFields,
    pronouns,
  ]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Profile</h2>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          Shown to everyone in your organization on your People profile. Job title, department,
          office and start date are set by your administrator.
        </p>
      </div>
      <ProfileForm key={revision} person={person} initialPronouns={pronouns} />
    </section>
  );
}
