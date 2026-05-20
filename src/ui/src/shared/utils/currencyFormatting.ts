/**
 * Currency formatting helpers built on Intl.NumberFormat.
 *
 * The org chooses its display currency on the backend; the UI never
 * hardcodes a symbol or label. Money values flow over the wire as
 * Decimal-as-string + an ISO 4217 currency code; the UI formats them
 * here with the user's locale so a EUR amount renders as ``1.234,56 €``
 * for de-DE and ``€1,234.56`` for en-US without extra logic at the
 * call site.
 */

export function formatCurrency(
    amount: number | string,
    currency: string,
    locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US',
): string {
    const value = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (!Number.isFinite(value)) return formatCurrency(0, currency, locale);
    const abs = Math.abs(value);
    const fractionDigits = abs > 0 && abs < 0.01 ? 4 : abs < 1 ? 3 : 2;
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'EUR',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value);
}

export function currencySymbol(
    currency: string,
    locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en-US',
): string {
    const parts = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'EUR',
        currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currency;
}

/**
 * Common ISO 4217 codes for the org currency picker. Not exhaustive --
 * orgs that need a code outside this list can type one in.
 */
export const COMMON_CURRENCIES: readonly string[] = [
    'EUR',
    'USD',
    'GBP',
    'BGN',
    'CHF',
    'JPY',
    'CAD',
    'AUD',
    'PLN',
    'CZK',
    'RON',
    'SEK',
    'NOK',
    'DKK',
    'HUF',
];
