/** Money flows over the wire as Decimal-as-string + ISO 4217 code; locale-aware formatting happens here so call sites stay clean. */
export function formatCurrency(
  amount: number | string,
  currency: string,
  locale: string = typeof navigator !== "undefined" ? navigator.language : "en-US",
): string {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(value)) return formatCurrency(0, currency, locale);
  const abs = Math.abs(value);
  const fractionDigits = abs > 0 && abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function currencySymbol(
  currency: string,
  locale: string = typeof navigator !== "undefined" ? navigator.language : "en-US",
): string {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency || "EUR",
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? currency;
}

/** Picker shortlist; orgs that need a code outside this list can type one in. */
export const COMMON_CURRENCIES: readonly string[] = [
  "EUR",
  "USD",
  "GBP",
  "BGN",
  "CHF",
  "JPY",
  "CAD",
  "AUD",
  "PLN",
  "CZK",
  "RON",
  "SEK",
  "NOK",
  "DKK",
  "HUF",
];
