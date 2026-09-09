const STATUS_CODE_MESSAGES: Record<string, string> = {
  unauthenticated: "Your session has expired. Please sign in again.",
  permission_denied: "You do not have permission to perform this action.",
  not_found: "The item you requested could not be found.",
  already_exists: "This item already exists.",
  invalid_argument: "Some of the information provided is invalid.",
  failed_precondition: "This action cannot be performed right now.",
  aborted: "This change conflicts with another update. Please refresh and try again.",
  out_of_range: "The value provided is out of the allowed range.",
  resource_exhausted: "Too many requests. Please wait a moment and try again.",

  internal: "Something went wrong on our end. Please try again shortly.",
  unavailable: "The server is temporarily unavailable. Please try again in a moment.",
  unimplemented: "This feature is not available yet.",
  unknown: "An unexpected error occurred. Please try again.",
  data_loss: "Something went wrong on our end. Please try again shortly.",
  deadline_exceeded: "The request took too long. Please try again.",
};

const HTTP_STATUS_MESSAGES: Record<number, string> = {
  400: "The request was invalid. Please check your input and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to perform this action.",
  404: "The item you requested could not be found.",
  408: "The request timed out. Please try again.",
  409: "This conflicts with another change. Please refresh and try again.",
  413: "The file is too large to upload.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Something went wrong on our end. Please try again shortly.",
  502: "The server is temporarily unavailable. Please try again in a moment.",
  503: "The server is temporarily unavailable. Please try again in a moment.",
  504: "The request took too long. Please try again.",
};

const MESSAGE_PATTERNS: [RegExp, string][] = [
  [
    /^skill_evaluation_queue_unavailable$/,
    "Evaluations are unavailable. Run the case again when the service is back.",
  ],
  [
    /^skill_evaluation_provider_required$/,
    "An organization admin needs to configure an AI provider before evaluations can run.",
  ],
  [
    /^skill_evaluation_access_revoked$/,
    "The agent is no longer accessible to the builder who requested this evaluation.",
  ],
  [
    /^skill_evaluation_budget_exceeded$/,
    "The AI usage budget has been reached. Run the case after the budget is available.",
  ],
  [
    /^skill_evaluation_invalid_response$/,
    "The model returned a response the evaluator could not read.",
  ],
  [
    /^skill_evaluation_(interrupted|provider_error)$/,
    "The evaluation did not finish. You can request a new run.",
  ],
  [
    /^skill_evaluation_judge_/,
    "Rubric judging did not finish. The tool assertions remain available.",
  ],
  [
    /^skill_generation_queue_unavailable$/,
    "Generation is unavailable. Try again when the service is back.",
  ],
  [
    /^skill_generation_provider_required$/,
    "An organization admin needs to configure an AI provider before generation can run.",
  ],
  [
    /^skill_generation_access_revoked$/,
    "The selected conversation or agent is no longer accessible.",
  ],
  [
    /^skill_generation_budget_exceeded$/,
    "The AI usage budget has been reached. Retry after the budget is available.",
  ],
  [
    /^skill_generation_invalid_proposal$/,
    "The AI response could not be used as a skill. You can retry generation.",
  ],
  [
    /^skill_generation_(interrupted|generation_failed)$/,
    "Generation did not finish. You can retry generation.",
  ],
  [
    /fetch failed|failed to fetch|networkerror/i,
    "Could not connect to the server. Please check your internet connection.",
  ],
  [/timeout|timed?\s*out/i, "The request timed out. Please try again."],
  [/abort/i, ""], // empty = suppress
  [/per free\/busy query/i, ""], // the scheduling panel renders the cap inline
  [
    /notallowederror|permission denied/i,
    "Screen recording permission denied. Click the camcorder icon to retry.",
  ],
  [/notfounderror|no recording source/i, "No screen, window, or tab is available to record."],
  [
    /encodingerror|encoder initialization failed/i,
    "Recording encoder failed. Try again, or restart your browser if it keeps happening.",
  ],
];

/** Validation field the skill draft save rejects with when the name is already taken. */
export const SKILL_NAME_CONFLICT_FIELD = "skill_name_conflict";

/** Translate a raw API/network error into user-facing copy. Returns `null` to suppress (e.g. aborts). */
export function friendlyErrorMessage(raw: string): string | null {
  if (!raw) return null;

  const lower = raw.toLowerCase().trim();

  if (lower === "rejected" || lower === "aborterror") {
    return null;
  }
  // Notes autosave owns its own conflict UX; suppress the generic toast.
  if (raw === "versionConflict") {
    return null;
  }
  // The skill draft review surface asks for a replace confirmation instead.
  if (raw.includes(SKILL_NAME_CONFLICT_FIELD)) {
    return null;
  }

  const codeMatch = lower.match(/^\[(\w+)]/);
  if (codeMatch) {
    const code = codeMatch[1];
    // Prefer the server's specific message for these codes.
    if (code === "failed_precondition" || code === "invalid_argument") {
      let serverMsg = raw.replace(/^\[\w+]\s*/, "").trim();
      serverMsg = serverMsg.replace(/^Validation error on '\w+':\s*/i, "");
      return serverMsg || STATUS_CODE_MESSAGES[code];
    }
    if (STATUS_CODE_MESSAGES[code]) {
      return STATUS_CODE_MESSAGES[code];
    }
  }

  const httpMatch = lower.match(/\b(4\d{2}|5\d{2})\b/);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (HTTP_STATUS_MESSAGES[status]) {
      return HTTP_STATUS_MESSAGES[status];
    }
    if (status >= 500) {
      return "Something went wrong on our end. Please try again shortly.";
    }
  }

  for (const [pattern, message] of MESSAGE_PATTERNS) {
    if (pattern.test(raw)) {
      return message || null;
    }
  }

  return raw;
}
