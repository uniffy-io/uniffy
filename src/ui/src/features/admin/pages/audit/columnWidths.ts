/**
 * Audit table column layout.
 *
 * Static `grid-template-columns` for the audit table. The target column
 * absorbs slack with `minmax(_, 1fr)`; the trailing visible column is
 * fixed so right-aligned data (IP / target) sits cleanly against the
 * card edge.
 */

export function auditGridTemplate(showIp: boolean): string {
    if (showIp) {
        return '32px 150px minmax(180px, 220px) minmax(160px, 240px) minmax(180px, 1fr) 140px';
    }
    return '32px 150px minmax(180px, 220px) minmax(160px, 240px) minmax(180px, 1fr)';
}
