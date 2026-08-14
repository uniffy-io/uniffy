import { SUBJECT_TYPE, type Subject } from "@/components/subject/types";
import type { Attendee } from "@/features/calendar/types/attendee";

/** Attendee rows only store an id; a resolved GROUP subject keeps its type and
 *  kind so team/group chips do not render as users. */
export function attendeeChipSubject(attendee: Attendee, resolved: Subject | undefined): Subject {
  if (resolved && resolved.type === SUBJECT_TYPE.GROUP) {
    return {
      ...resolved,
      name: attendee.name || resolved.name,
    };
  }
  return {
    id: attendee.id,
    type: SUBJECT_TYPE.USER,
    name: attendee.name || attendee.email,
    email: attendee.email,
    avatarUrl: attendee.avatarUrl,
  };
}
