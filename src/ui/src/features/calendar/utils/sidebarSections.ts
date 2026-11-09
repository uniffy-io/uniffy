import type {
  CalendarInfo,
  CalendarPolicyInfo,
  CalendarSection,
  SidebarSectionId,
} from "@/features/calendar/types";

const SECTIONS: { section: CalendarSection; id: SidebarSectionId; title: string }[] = [
  { section: "mine", id: "calendars", title: "My calendars" },
  { section: "subscribed", id: "subscribed_calendars", title: "Subscribed" },
  { section: "connected", id: "connected_calendars", title: "Connected" },
  { section: "shared", id: "shared_calendars", title: "Shared with me" },
  { section: "organization", id: "organization", title: "Organization" },
];

export interface SidebarCalendarSection {
  section: CalendarSection;
  id: SidebarSectionId;
  title: string;
  rows: CalendarInfo[];
}

/**
 * The calendar list's sections in order. "Mine" always shows, so there is somewhere to create
 * the first calendar; "Subscribed" and "Connected" also show empty whenever the member may add one.
 */
export function sidebarSections(
  calendars: CalendarInfo[],
  policy: CalendarPolicyInfo | null,
): SidebarCalendarSection[] {
  return SECTIONS.flatMap(({ section, id, title }) => {
    const rows = calendars.filter((calendar) => calendar.section === section);
    const alwaysShown =
      section === "mine" ||
      (section === "subscribed" && !!policy?.canSubscribeExternalCalendars) ||
      (section === "connected" && !!policy?.canConnectProviders);
    return rows.length === 0 && !alwaysShown ? [] : [{ section, id, title, rows }];
  });
}
