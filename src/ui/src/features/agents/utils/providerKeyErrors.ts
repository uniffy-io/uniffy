/**
 * `last_error` is the provider's raw rejection text - a status line with a JSON
 * body, request ids and all. It is the only diagnostic an admin gets, so it is
 * kept, but the banner leads with a sentence that says what to do about it.
 */
export interface KeyErrorSummary {
  headline: string;
  detail: string | null;
}

function statusCode(raw: string): number | null {
  const match =
    raw.match(/\b(?:error code|status|http)\D{0,3}(\d{3})\b/i) ?? raw.match(/\b([45]\d{2})\b/);
  const code = match ? Number(match[1]) : NaN;
  return Number.isFinite(code) ? code : null;
}

export function summarizeKeyError(raw: string | undefined, provider: string): KeyErrorSummary {
  const detail = raw?.trim() || null;
  if (!detail) {
    return { headline: `${provider} rejected this key.`, detail: null };
  }

  const lowered = detail.toLowerCase();
  const code = statusCode(detail);

  if (code === 401 || code === 403 || lowered.includes("authentication")) {
    return {
      headline: `${provider} did not accept this credential. Keys cannot be edited, so add a new one and remove this key.`,
      detail,
    };
  }
  if (code === 402 || lowered.includes("quota") || lowered.includes("billing")) {
    return {
      headline: `${provider} accepted the credential but reports no available credit on the account.`,
      detail,
    };
  }
  if (code === 429) {
    return {
      headline: `${provider} rate-limited the check. Validate again in a moment.`,
      detail,
    };
  }
  if (
    (code !== null && code >= 500) ||
    lowered.includes("timeout") ||
    lowered.includes("connect")
  ) {
    return {
      headline: `${provider} could not be reached. The key may be fine - validate again once the provider responds.`,
      detail,
    };
  }
  return { headline: `${provider} rejected this key.`, detail };
}
