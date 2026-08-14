import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LockSimple, X } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  SubjectAvatarById,
  SubjectSearchInput,
  SubjectSearchResults,
  useSubjectResolver,
  useSubjectSearch,
} from "@/components/subject";
import {
  fetchPersonThunk,
  setManagerThunk,
  updatePersonProfileThunk,
  type PersonProfileChanges,
} from "@/features/people/store/peopleThunks";

interface MemberProfileDialogProps {
  userId: string;
  displayName: string;
  onClose: () => void;
}

function FieldLabel({
  label,
  managed,
  htmlFor,
}: {
  label: string;
  managed: boolean;
  htmlFor?: string;
}) {
  return (
    <label
      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      htmlFor={htmlFor}
    >
      {label}
      {managed && (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70"
          title="Synced from directory"
        >
          <LockSimple size={10} weight="fill" />
          Synced from directory
        </span>
      )}
    </label>
  );
}

const inputClass =
  "mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function MemberProfileDialog({ userId, displayName, onClose }: MemberProfileDialogProps) {
  const dispatch = useAppDispatch();
  const person = useAppSelector((s) => s.people.profilesById[userId]);
  const status = useAppSelector((s) => s.people.profileStatusById[userId] ?? "idle");

  useEffect(() => {
    dispatch(fetchPersonThunk({ userId }));
  }, [dispatch, userId]);

  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [officeLocation, setOfficeLocation] = useState("");
  const [workPhone, setWorkPhone] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [startDate, setStartDate] = useState("");
  const [managerUserId, setManagerUserId] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState("");

  // Seed the form once the profile arrives; a re-fetch must not clobber edits.
  useEffect(() => {
    if (!person || loadedFor === person.userId) return;
    // eslint-disable-next-line react/react-compiler
    setJobTitle(person.jobTitle ?? "");
    setDepartment(person.department ?? "");
    setOfficeLocation(person.officeLocation ?? "");
    setWorkPhone(person.workPhone ?? "");
    setMobilePhone(person.mobilePhone ?? "");
    setStartDate(
      person.startDateMs !== null ? new Date(person.startDateMs).toISOString().slice(0, 10) : "",
    );
    setManagerUserId(person.managerUserId);
    setLoadedFor(person.userId);
  }, [person, loadedFor]);

  const { subjects: managerSubjects } = useSubjectResolver(managerUserId ? [managerUserId] : []);
  const managerSubject = managerSubjects[0];

  const [managerQuery, setManagerQuery] = useState("");
  const {
    results: managerResults,
    loading: searchingManagers,
    search: searchManagers,
  } = useSubjectSearch({ subjectTypes: "users", excludeIds: [userId] });

  useEffect(() => {
    searchManagers(managerQuery);
  }, [managerQuery, searchManagers]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isManaged = (field: string) => person?.managedFields.includes(field) ?? false;

  const handleSave = async () => {
    if (!person) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const changes: PersonProfileChanges = {};
      if (jobTitle !== (person.jobTitle ?? "")) changes.jobTitle = jobTitle;
      if (department !== (person.department ?? "")) changes.department = department;
      if (officeLocation !== (person.officeLocation ?? "")) {
        changes.officeLocation = officeLocation;
      }
      if (workPhone !== (person.workPhone ?? "")) changes.workPhone = workPhone;
      if (mobilePhone !== (person.mobilePhone ?? "")) changes.mobilePhone = mobilePhone;
      const initialStartDate =
        person.startDateMs !== null ? new Date(person.startDateMs).toISOString().slice(0, 10) : "";
      if (startDate && startDate !== initialStartDate) {
        changes.startDateMs = Date.parse(`${startDate}T00:00:00Z`);
      }

      if (Object.keys(changes).length > 0) {
        const action = await dispatch(updatePersonProfileThunk({ userId, changes }));
        if (updatePersonProfileThunk.rejected.match(action)) {
          setError((action.payload ?? action.error.message ?? "Failed to save").toString());
          return;
        }
      }

      if (managerUserId !== person.managerUserId) {
        const action = await dispatch(setManagerThunk({ userId, managerUserId }));
        if (setManagerThunk.rejected.match(action)) {
          setError((action.payload ?? action.error.message ?? "Failed to set manager").toString());
          return;
        }
      }
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-lg">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Edit profile: {displayName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      </div>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
        {status === "failed" && (
          <p className="text-sm text-muted-foreground">
            Could not load this member&apos;s profile.
          </p>
        )}

        {person && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel
                  label="Job title"
                  managed={isManaged("job_title")}
                  htmlFor="member-job-title"
                />
                <input
                  id="member-job-title"
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  disabled={isManaged("job_title")}
                  className={inputClass}
                  maxLength={120}
                />
              </div>
              <div>
                <FieldLabel
                  label="Department"
                  managed={isManaged("department")}
                  htmlFor="member-department"
                />
                <input
                  id="member-department"
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  disabled={isManaged("department")}
                  className={inputClass}
                  maxLength={120}
                />
              </div>
            </div>

            <div>
              <FieldLabel
                label="Office"
                managed={isManaged("office_location")}
                htmlFor="member-office"
              />
              <input
                id="member-office"
                type="text"
                value={officeLocation}
                onChange={(e) => setOfficeLocation(e.target.value)}
                disabled={isManaged("office_location")}
                className={inputClass}
                maxLength={120}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel
                  label="Work phone"
                  managed={isManaged("work_phone")}
                  htmlFor="member-work-phone"
                />
                <input
                  id="member-work-phone"
                  type="tel"
                  value={workPhone}
                  onChange={(e) => setWorkPhone(e.target.value)}
                  disabled={isManaged("work_phone")}
                  className={inputClass}
                  maxLength={40}
                />
              </div>
              <div>
                <FieldLabel
                  label="Mobile phone"
                  managed={isManaged("mobile_phone")}
                  htmlFor="member-mobile-phone"
                />
                <input
                  id="member-mobile-phone"
                  type="tel"
                  value={mobilePhone}
                  onChange={(e) => setMobilePhone(e.target.value)}
                  disabled={isManaged("mobile_phone")}
                  className={inputClass}
                  maxLength={40}
                />
              </div>
            </div>

            <div>
              <FieldLabel label="Start date" managed={isManaged("start_date")} />
              <div className="mt-1.5">
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  disabled={isManaged("start_date")}
                  placeholder="Pick a start date"
                />
              </div>
            </div>

            <div>
              <FieldLabel label="Manager" managed={isManaged("manager_user_id")} />
              {managerUserId ? (
                <div className="mt-1.5 flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2">
                  <SubjectAvatarById
                    userId={managerUserId}
                    displayName={managerSubject?.name}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {managerSubject?.name ?? managerUserId.slice(-6)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setManagerUserId(null)}
                    disabled={isManaged("manager_user_id")}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                    aria-label="Clear manager"
                  >
                    <X size={14} weight="bold" />
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 space-y-2">
                  <SubjectSearchInput
                    value={managerQuery}
                    onChange={setManagerQuery}
                    placeholder="Search for a manager..."
                    disabled={isManaged("manager_user_id")}
                  />
                  {managerQuery.trim().length >= 2 && (
                    <SubjectSearchResults
                      results={managerResults}
                      loading={searchingManagers}
                      query={managerQuery}
                      actionLabel="Select"
                      onSelect={(subject) => {
                        setManagerUserId(subject.id);
                        setManagerQuery("");
                      }}
                      className="max-h-48 overflow-y-auto rounded-md border border-border p-1"
                    />
                  )}
                </div>
              )}
            </div>

            <div>
              <FieldLabel label="Teams" managed={false} />
              {person.teams.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {person.teams.map((team) => (
                    <Link
                      key={team.groupId}
                      to={`/people?team=${team.groupId}`}
                      onClick={onClose}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      {team.name}
                      {team.leadUserId === person.userId && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold text-primary">
                          Lead
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">Not on any team.</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Rosters are edited in{" "}
                <Link to="/admin/teams" onClick={onClose} className="text-primary hover:underline">
                  Teams
                </Link>
                .
              </p>
            </div>
          </>
        )}

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} loading={isSubmitting} disabled={!person}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
