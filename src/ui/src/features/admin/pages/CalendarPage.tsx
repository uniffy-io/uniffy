import { useAppSelector } from "@/app/hooks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { CalendarDelegationsSection } from "@/features/admin/components/calendar/CalendarDelegationsSection";
import { CalendarPolicySection } from "@/features/admin/components/calendar/CalendarPolicySection";
import { SharedCalendarsSection } from "@/features/admin/components/calendar/SharedCalendarsSection";

export function CalendarPage() {
  useDocumentTitle("Calendar");
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  // Keyed on the organization so switching tenants never shows the previous one's rows.
  return (
    <div key={organizationId ?? ""} className="space-y-10">
      <CalendarPolicySection />
      <CalendarDelegationsSection />
      <SharedCalendarsSection />
    </div>
  );
}
