/**
 * What an RSVP link can say, and what the server's answer means to the person.
 *
 * Every lookup here is keyed by a value taken straight out of a URL, so they
 * are Maps rather than plain objects: `answers["constructor"]` on an object
 * literal resolves up the prototype chain and hands back a function.
 */

const ANSWER_LABELS = new Map<string, string>([
  ["accepted", "Yes"],
  ["tentative", "Maybe"],
  ["declined", "No"],
]);

const CONFIRMATIONS = new Map<string, string>([
  ["accepted", "You are going. The organizer has been told."],
  ["tentative", "You answered maybe. The organizer has been told."],
  ["declined", "You are not going. The organizer has been told."],
]);

const REFUSALS = new Map<number, string>([
  [401, "This link has expired. Open the event in Uniffy to answer."],
  [403, "You are no longer invited to this event."],
  [404, "This event is no longer available."],
  [409, "This invitation can no longer be answered."],
  [429, "Too many attempts. Try again a little later."],
]);

export const GENERIC_REFUSAL = "That did not work. Open the event in Uniffy to answer.";
export const INCOMPLETE_LINK = "This link is incomplete. Open the event in Uniffy to answer.";

export const RESPOND_ANSWERS = Array.from(ANSWER_LABELS.keys());

/** Whether the link carries everything needed to answer at all. */
export function isUsableRespondLink(token: string, answer: string): boolean {
  return Boolean(token) && ANSWER_LABELS.has(answer);
}

export function answerLabelFor(answer: string): string | null {
  return ANSWER_LABELS.get(answer) ?? null;
}

export function confirmationFor(answer: string): string | null {
  return CONFIRMATIONS.get(answer) ?? null;
}

/**
 * Say why the answer did not land, in the recipient's terms.
 *
 * Every refusal names a cause the person can act on, and none of them leak
 * whether the event exists or who else is on it - a link lives in an inbox and
 * may be read by someone it was not sent to.
 */
export function refusalFor(status: number): string {
  return REFUSALS.get(status) ?? GENERIC_REFUSAL;
}
