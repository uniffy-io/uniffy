import { randomUUID } from "@/shared/utils/uuid";

/** One id per tab; echoed back on DRAFT_CHANGED so this session can ignore its own events. */
export const draftClientSessionId = randomUUID();
