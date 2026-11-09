import { timestampDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  CalendarProvider as ProtoProvider,
  CalendarSyncDirection as ProtoDirection,
  CalendarSyncError as ProtoSyncError,
  ConnectedCalendarState as ProtoState,
  ParticipantResponse as ProtoParticipantResponse,
  ProviderSyncAudience as ProtoAudience,
} from "@uniffy/proto/cal/v1/calendar_pb";
import type {
  ConnectedCalendarSummary as ProtoSummary,
  EventParticipant as ProtoParticipant,
} from "@uniffy/proto/cal/v1/calendar_pb";
import {
  CalendarConnectionStatus as ProtoConnectionStatus,
  ProviderCalendarAccess as ProtoAccess,
  ProviderCredentialSource as ProtoCredentialSource,
} from "@uniffy/proto/cal/v1/connections_pb";
import type {
  CalendarConnection as ProtoConnection,
  ProviderAppSettings as ProtoAppSettings,
  ProviderAvailability as ProtoAvailability,
  ProviderCalendar as ProtoProviderCalendar,
} from "@uniffy/proto/cal/v1/connections_pb";
import type {
  CalendarConnectionInfo,
  CalendarConnectionStatus,
  CalendarProviderId,
  CalendarSyncDirection,
  CalendarSyncError,
  ConnectedCalendarState,
  ConnectedCalendarSummary,
  EventParticipant,
  ParticipantResponse,
  ProviderAppSettingsInfo,
  ProviderAvailabilityInfo,
  ProviderCalendarAccess,
  ProviderCalendarInfo,
  ProviderCredentialSource,
  ProviderSettingsInfo,
  ProviderSyncAudience,
} from "@/features/calendar/types/connections";

const PROVIDER_FROM_PROTO: Record<number, CalendarProviderId> = {
  [ProtoProvider.GOOGLE]: "google",
  [ProtoProvider.MICROSOFT]: "microsoft",
};

export const PROVIDER_TO_PROTO: Record<CalendarProviderId, ProtoProvider> = {
  google: ProtoProvider.GOOGLE,
  microsoft: ProtoProvider.MICROSOFT,
};

const DIRECTION_FROM_PROTO: Record<number, CalendarSyncDirection> = {
  [ProtoDirection.INBOUND]: "inbound",
  [ProtoDirection.TWO_WAY]: "two_way",
};

export const DIRECTION_TO_PROTO: Record<CalendarSyncDirection, ProtoDirection> = {
  inbound: ProtoDirection.INBOUND,
  two_way: ProtoDirection.TWO_WAY,
};

const STATE_FROM_PROTO: Record<number, ConnectedCalendarState> = {
  [ProtoState.PENDING]: "pending",
  [ProtoState.HEALTHY]: "healthy",
  [ProtoState.FAILING]: "failing",
  [ProtoState.BROKEN]: "broken",
  [ProtoState.PAUSED]: "paused",
  [ProtoState.REAUTH_REQUIRED]: "reauth_required",
  [ProtoState.DETACHED]: "detached",
};

const SYNC_ERROR_FROM_PROTO: Record<number, CalendarSyncError> = {
  [ProtoSyncError.UNREACHABLE]: "unreachable",
  [ProtoSyncError.RATE_LIMITED]: "rate_limited",
  [ProtoSyncError.PROVIDER_ERROR]: "provider_error",
  [ProtoSyncError.PERMISSION_DENIED]: "permission_denied",
  [ProtoSyncError.NOT_FOUND]: "not_found",
  [ProtoSyncError.REAUTH_REQUIRED]: "reauth_required",
  [ProtoSyncError.UNPROCESSABLE]: "unprocessable",
};

const RESPONSE_FROM_PROTO: Record<number, ParticipantResponse> = {
  [ProtoParticipantResponse.ACCEPTED]: "accepted",
  [ProtoParticipantResponse.TENTATIVE]: "tentative",
  [ProtoParticipantResponse.DECLINED]: "declined",
  [ProtoParticipantResponse.PENDING]: "pending",
};

const CONNECTION_STATUS_FROM_PROTO: Record<number, CalendarConnectionStatus> = {
  [ProtoConnectionStatus.ACTIVE]: "active",
  [ProtoConnectionStatus.PAUSED]: "paused",
  [ProtoConnectionStatus.REAUTH_REQUIRED]: "reauth_required",
  [ProtoConnectionStatus.DISCONNECTED]: "disconnected",
};

const ACCESS_FROM_PROTO: Record<number, ProviderCalendarAccess> = {
  [ProtoAccess.OWNER]: "owner",
  [ProtoAccess.WRITER]: "writer",
  [ProtoAccess.READER]: "reader",
  [ProtoAccess.FREE_BUSY]: "free_busy",
};

const CREDENTIAL_SOURCE_FROM_PROTO: Record<number, ProviderCredentialSource> = {
  [ProtoCredentialSource.NONE]: "none",
  [ProtoCredentialSource.ORGANIZATION]: "organization",
  [ProtoCredentialSource.DEPLOYMENT]: "deployment",
};

const AUDIENCE_FROM_PROTO: Record<number, ProviderSyncAudience> = {
  [ProtoAudience.OFF]: "off",
  [ProtoAudience.ADMINS]: "admins",
  [ProtoAudience.EVERYONE]: "everyone",
};

export const AUDIENCE_TO_PROTO: Record<ProviderSyncAudience, ProtoAudience> = {
  off: ProtoAudience.OFF,
  admins: ProtoAudience.ADMINS,
  everyone: ProtoAudience.EVERYONE,
};

const isoOf = (timestamp: Timestamp | undefined): string | undefined =>
  timestamp ? timestampDate(timestamp).toISOString() : undefined;

export const providerFromProto = (value: number): CalendarProviderId | null =>
  PROVIDER_FROM_PROTO[value] ?? null;

/** An audience the client does not know reads as off, the most restrictive answer. */
export const providerSyncAudienceFromProto = (value: number): ProviderSyncAudience =>
  AUDIENCE_FROM_PROTO[value] ?? "off";

export const connectedSummaryFromProto = (proto: ProtoSummary): ConnectedCalendarSummary => ({
  connectedCalendarId: proto.connectedCalendarId,
  connectionId: proto.connectionId,
  provider: providerFromProto(proto.provider),
  accountEmail: proto.accountEmail,
  direction: DIRECTION_FROM_PROTO[proto.direction] ?? "inbound",
  state: STATE_FROM_PROTO[proto.state] ?? "pending",
  lastError: SYNC_ERROR_FROM_PROTO[proto.lastError],
  lastSuccessAt: isoOf(proto.lastSuccessAt),
  countsAsBusy: proto.countsAsBusy,
});

export const participantFromProto = (proto: ProtoParticipant): EventParticipant => ({
  email: proto.email,
  displayName: proto.displayName,
  response: RESPONSE_FROM_PROTO[proto.response] ?? "pending",
  isOrganizer: proto.isOrganizer,
  isOptional: proto.isOptional,
  userId: proto.userId || undefined,
});

export const providerCalendarFromProto = (proto: ProtoProviderCalendar): ProviderCalendarInfo => ({
  id: proto.id,
  name: proto.name,
  providerColor: proto.providerColor,
  access: ACCESS_FROM_PROTO[proto.access],
  isPrimary: proto.isPrimary,
  isSystem: proto.isSystem,
  syncEnabled: proto.syncEnabled,
  direction: DIRECTION_FROM_PROTO[proto.direction] ?? "inbound",
  canWrite: proto.canWrite,
  countsAsBusy: proto.countsAsBusy,
  calendarId: proto.calendarId || undefined,
  state: STATE_FROM_PROTO[proto.state] ?? "pending",
  lastError: SYNC_ERROR_FROM_PROTO[proto.lastError],
  lastSuccessAt: isoOf(proto.lastSuccessAt),
  eventCount: proto.eventCount,
  skippedCount: proto.skippedCount,
});

export const connectionFromProto = (proto: ProtoConnection): CalendarConnectionInfo => ({
  id: proto.id,
  provider: providerFromProto(proto.provider),
  accountEmail: proto.accountEmail,
  status: CONNECTION_STATUS_FROM_PROTO[proto.status] ?? "active",
  calendars: proto.calendars.map(providerCalendarFromProto),
  lastSyncedAt: isoOf(proto.lastSyncedAt),
  createdAt: isoOf(proto.createdAt) ?? "",
});

/** Providers this client does not know are dropped; they cannot be offered or drawn. */
export const availabilityFromProto = (providers: ProtoAvailability[]): ProviderAvailabilityInfo[] =>
  providers.flatMap((proto) => {
    const provider = providerFromProto(proto.provider);
    if (!provider) return [];
    return [
      {
        provider,
        configured: proto.configured,
        credentialSource: CREDENTIAL_SOURCE_FROM_PROTO[proto.credentialSource] ?? "none",
        writesEnabled: proto.writesEnabled,
      },
    ];
  });

export const providerSettingsFromProto = (response: {
  providers: ProtoAppSettings[];
  redirectUri: string;
}): ProviderSettingsInfo => ({
  providers: response.providers.flatMap((proto): ProviderAppSettingsInfo[] => {
    const provider = providerFromProto(proto.provider);
    if (!provider) return [];
    return [
      {
        provider,
        source: CREDENTIAL_SOURCE_FROM_PROTO[proto.source] ?? "none",
        clientId: proto.clientId,
        clientSecretHint: proto.clientSecretHint,
        tenant: proto.tenant,
        deploymentConfigured: proto.deploymentConfigured,
      },
    ];
  }),
  redirectUri: response.redirectUri,
});
