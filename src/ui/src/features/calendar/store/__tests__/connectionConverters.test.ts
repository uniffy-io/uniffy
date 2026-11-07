import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  CalendarListSection,
  CalendarProvider,
  CalendarSchema,
  CalendarSyncDirection,
  CalendarSyncError,
  CalendarType,
  ConnectedCalendarState,
  EventParticipantSchema,
  ParticipantResponse,
  ProviderSyncAudience,
} from "@uniffy/proto/cal/v1/calendar_pb";
import {
  CalendarConnectionSchema,
  CalendarConnectionStatus,
  ProviderAvailabilitySchema,
  ProviderCalendarAccess,
  ProviderCredentialSource,
} from "@uniffy/proto/cal/v1/connections_pb";
import {
  availabilityFromProto,
  connectionFromProto,
  participantFromProto,
  providerSettingsFromProto,
} from "@/features/calendar/store/connectionConverters";
import { calendarFromProto, policyFromProto } from "@/features/calendar/store/calendarsThunks";

vi.mock("@/features/calendar/api/calendarApi", () => ({ calendarApi: {} }));
vi.mock("@/features/calendar/store/calendarThunks", () => ({
  getOrganizationId: () => "org",
  refreshVisibleRange: vi.fn(),
  timestampToIso: () => "",
}));

// A value a newer server may send that this client has no name for.
const UNKNOWN = 99 as never;

describe("connected calendar mapping", () => {
  it("maps a connected calendar with its provider summary", () => {
    const calendar = calendarFromProto(
      create(CalendarSchema, {
        id: "cal",
        calendarType: CalendarType.CONNECTED,
        section: CalendarListSection.CONNECTED,
        connection: {
          connectedCalendarId: "cc",
          connectionId: "conn",
          provider: CalendarProvider.MICROSOFT,
          accountEmail: "ann@example.com",
          direction: CalendarSyncDirection.TWO_WAY,
          state: ConnectedCalendarState.REAUTH_REQUIRED,
          lastError: CalendarSyncError.REAUTH_REQUIRED,
          lastSuccessAt: timestampFromDate(new Date("2026-11-01T10:00:00Z")),
          countsAsBusy: true,
        },
      }),
    );
    expect(calendar.kind).toBe("connected");
    expect(calendar.section).toBe("connected");
    expect(calendar.connection).toEqual({
      connectedCalendarId: "cc",
      connectionId: "conn",
      provider: "microsoft",
      accountEmail: "ann@example.com",
      direction: "two_way",
      state: "reauth_required",
      lastError: "reauth_required",
      lastSuccessAt: "2026-11-01T10:00:00.000Z",
      countsAsBusy: true,
    });
  });

  it("reads unknown enum values without failing", () => {
    const calendar = calendarFromProto(
      create(CalendarSchema, {
        id: "cal",
        calendarType: UNKNOWN,
        section: UNKNOWN,
        connection: {
          provider: UNKNOWN,
          direction: UNKNOWN,
          state: UNKNOWN,
          lastError: UNKNOWN,
        },
      }),
    );
    expect(calendar.kind).toBe("personal");
    expect(calendar.section).toBe("mine");
    expect(calendar.connection).toMatchObject({
      provider: null,
      direction: "inbound",
      state: "pending",
      lastError: undefined,
      lastSuccessAt: undefined,
    });
  });

  it("maps an account with its calendars", () => {
    const connection = connectionFromProto(
      create(CalendarConnectionSchema, {
        id: "conn",
        provider: CalendarProvider.GOOGLE,
        accountEmail: "ann@example.com",
        status: CalendarConnectionStatus.PAUSED,
        calendars: [
          {
            id: "pc",
            name: "Work",
            providerColor: "#00ff00",
            access: ProviderCalendarAccess.WRITER,
            isPrimary: true,
            syncEnabled: true,
            direction: CalendarSyncDirection.INBOUND,
            canWrite: false,
            calendarId: "cal",
            state: ConnectedCalendarState.HEALTHY,
            eventCount: 4,
          },
          { id: "unknown", access: UNKNOWN, state: UNKNOWN, direction: UNKNOWN },
        ],
      }),
    );
    expect(connection.provider).toBe("google");
    expect(connection.status).toBe("paused");
    expect(connection.calendars[0]).toMatchObject({
      access: "writer",
      isPrimary: true,
      syncEnabled: true,
      direction: "inbound",
      canWrite: false,
      calendarId: "cal",
      state: "healthy",
      eventCount: 4,
    });
    expect(connection.calendars[1]).toMatchObject({
      access: undefined,
      state: "pending",
      direction: "inbound",
      calendarId: undefined,
    });
  });

  it("drops providers the client does not know", () => {
    expect(
      availabilityFromProto([
        create(ProviderAvailabilitySchema, {
          provider: CalendarProvider.GOOGLE,
          configured: true,
          credentialSource: ProviderCredentialSource.DEPLOYMENT,
          writesEnabled: true,
        }),
        create(ProviderAvailabilitySchema, { provider: UNKNOWN, configured: true }),
      ]),
    ).toEqual([
      { provider: "google", configured: true, credentialSource: "deployment", writesEnabled: true },
    ]);
  });

  it("keeps the redirect address and hides unknown provider apps", () => {
    const settings = providerSettingsFromProto({
      providers: [
        {
          provider: CalendarProvider.MICROSOFT,
          source: ProviderCredentialSource.ORGANIZATION,
          clientId: "id",
          clientSecretHint: "abcd",
          tenant: "contoso",
          deploymentConfigured: false,
        },
        { provider: UNKNOWN },
      ] as never,
      redirectUri: "https://uniffy.example/calendar/connect/callback",
    });
    expect(settings.redirectUri).toBe("https://uniffy.example/calendar/connect/callback");
    expect(settings.providers).toEqual([
      {
        provider: "microsoft",
        source: "organization",
        clientId: "id",
        clientSecretHint: "abcd",
        tenant: "contoso",
        deploymentConfigured: false,
      },
    ]);
  });

  it("maps a participant and treats an unknown answer as pending", () => {
    expect(
      participantFromProto(
        create(EventParticipantSchema, {
          email: "guest@example.com",
          displayName: "Guest",
          response: ParticipantResponse.TENTATIVE,
          isOptional: true,
        }),
      ),
    ).toEqual({
      email: "guest@example.com",
      displayName: "Guest",
      response: "tentative",
      isOrganizer: false,
      isOptional: true,
      userId: undefined,
    });
    expect(
      participantFromProto(create(EventParticipantSchema, { response: UNKNOWN })).response,
    ).toBe("pending");
  });
});

describe("calendar policy mapping", () => {
  it("carries the provider sync settings", () => {
    const policy = policyFromProto({
      policy: {
        providerSyncAudience: ProviderSyncAudience.ADMINS,
        allowProviderWrites: true,
      } as never,
      canCreateTeamCalendars: true,
      canShareCalendarsOrgWide: true,
      canSubscribeExternalCalendars: false,
      canConnectProviders: true,
    });
    expect(policy.providerSyncAudience).toBe("admins");
    expect(policy.allowProviderWrites).toBe(true);
    expect(policy.canConnectProviders).toBe(true);
  });

  it("reads an unknown audience as off", () => {
    const policy = policyFromProto({
      policy: { providerSyncAudience: UNKNOWN } as never,
      canCreateTeamCalendars: false,
      canShareCalendarsOrgWide: false,
      canSubscribeExternalCalendars: false,
      canConnectProviders: false,
    });
    expect(policy.providerSyncAudience).toBe("off");
  });
});
