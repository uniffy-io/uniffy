import type { ReactNode } from "react";
import { AddressBook, ArrowSquareOut, IdentificationCard } from "@phosphor-icons/react";
import { formatDateFull } from "@/shared/utils/dateFormatting";
import type { SerializedPersonProfile } from "@/features/people/store/peopleThunks";
import {
  ProfileEmptyState,
  ProfileSection,
} from "@/features/people/components/profile/ProfileSection";

interface ProfileFieldsProps {
  person: SerializedPersonProfile;
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-32 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

/** MM-DD -> "Apr 12"; the year is deliberately absent from the data. */
function formatBirthday(birthday: string): string {
  const [month, day] = birthday.split("-").map(Number);
  if (!month || !day) return birthday;
  return new Date(2000, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatLocalTime(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date());
  } catch {
    return null;
  }
}

export function ProfileFields({ person }: ProfileFieldsProps) {
  const localTime = person.timezone ? formatLocalTime(person.timezone) : null;

  const hasContact =
    person.email ||
    person.workPhone ||
    person.mobilePhone ||
    person.officeLocation ||
    person.timezone ||
    person.links.length > 0;

  const hasAbout = person.bio || person.startDateMs !== null || person.birthday;

  if (!hasContact && !hasAbout) {
    return (
      <ProfileEmptyState
        icon={IdentificationCard}
        title="Nothing here yet"
        description="Contact details and a bio show up once they are filled in."
      />
    );
  }

  return (
    <div className="space-y-4">
      {hasContact && (
        <ProfileSection title="Contact" icon={AddressBook}>
          <dl className="space-y-2.5">
            {person.email && (
              <FieldRow label="Email">
                <a href={`mailto:${person.email}`} className="text-primary hover:underline">
                  {person.email}
                </a>
              </FieldRow>
            )}
            {person.workPhone && (
              <FieldRow label="Work phone">
                <a href={`tel:${person.workPhone}`} className="hover:underline">
                  {person.workPhone}
                </a>
              </FieldRow>
            )}
            {person.mobilePhone && (
              <FieldRow label="Mobile phone">
                <a href={`tel:${person.mobilePhone}`} className="hover:underline">
                  {person.mobilePhone}
                </a>
              </FieldRow>
            )}
            {person.officeLocation && <FieldRow label="Office">{person.officeLocation}</FieldRow>}
            {person.timezone && (
              <FieldRow label="Time zone">
                {person.timezone}
                {localTime && (
                  <span className="ml-2 text-xs text-subtle-foreground">
                    {localTime} local time
                  </span>
                )}
              </FieldRow>
            )}
            {person.links.length > 0 && (
              <FieldRow label="Links">
                <div className="flex flex-col gap-1">
                  {person.links.map((link) => (
                    <a
                      key={`${link.label}-${link.url}`}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {link.label || link.url}
                      <ArrowSquareOut size={12} />
                    </a>
                  ))}
                </div>
              </FieldRow>
            )}
          </dl>
        </ProfileSection>
      )}

      {hasAbout && (
        <ProfileSection title="About" icon={IdentificationCard}>
          <dl className="space-y-2.5">
            {person.bio && (
              <FieldRow label="Bio">
                <p className="whitespace-pre-wrap">{person.bio}</p>
              </FieldRow>
            )}
            {person.startDateMs !== null && (
              <FieldRow label="Started">
                {formatDateFull(new Date(person.startDateMs).toISOString().slice(0, 10))}
              </FieldRow>
            )}
            {person.birthday && (
              <FieldRow label="Birthday">{formatBirthday(person.birthday)}</FieldRow>
            )}
          </dl>
        </ProfileSection>
      )}
    </div>
  );
}
