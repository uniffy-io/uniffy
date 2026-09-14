/** Mirrors GROUP_DM_MAX_PARTICIPANTS in the backend; the server is the gate, this is the affordance. */
export const GROUP_DM_MAX_PARTICIPANTS = 9;

/** The creator is a participant too, so a new group DM takes one fewer recipient. */
export const NEW_DM_MAX_RECIPIENTS = GROUP_DM_MAX_PARTICIPANTS - 1;
