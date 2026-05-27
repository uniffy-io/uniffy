/**
 * Shared audit-view types used by both `/admin/audit-logs` (org-scoped)
 * and `/platform/audit` (cross-tenant). Each consuming page maps its
 * proto rows into `AuditEvent` and tells the rail which filters apply.
 */

export interface AuditEvent {
    id: string;
    createdAt: string;
    action: string;
    actorUserId: string | null;
    actorEmail: string | null;
    actorOrgRole: string | null;
    organizationId: string | null;
    organizationName: string | null;
    resourceType: string | null;
    resourceId: string | null;
    detailsJson: string;
    ipAddress: string | null;
    userAgent: string | null;
    onBehalfOfUserId: string | null;
}

export interface AuditFilter {
    actorUserId: string | null;
    actions: string[];
    resourceType: string | null;
    resourceId: string | null;
    fromTime: string | null;
    toTime: string | null;
    organizationId: string | null;
}

export const EMPTY_AUDIT_FILTER: AuditFilter = {
    actorUserId: null,
    actions: [],
    resourceType: null,
    resourceId: null,
    fromTime: null,
    toTime: null,
    organizationId: null,
};

export interface AuditFilterFields {
    dateRange: boolean;
    actor: boolean;
    actions: boolean;
    resourceType: boolean;
    resourceUrn: boolean;
    organization: boolean;
}

export interface ActionEntry {
    value: string;
    label: string;
}

export interface ActionGroup {
    domain: string;
    label: string;
    actions: ActionEntry[];
}

export interface OrganizationOption {
    id: string;
    name: string;
    slug: string;
}
