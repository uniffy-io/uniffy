"""Google Calendar API v3 and Google OAuth over the fixed Google hosts."""

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

from uniffy.core.models.calendar.connection import CalendarProvider, ProviderAccessRole, SyncFailure
from uniffy.domains.scheduling.calendar.connections.normalize import (
    ChangeBatch,
    ItemKind,
    ProviderEvent,
    SkippedItem,
)
from uniffy.domains.scheduling.calendar.connections.providers.base import (
    CursorExpired,
    PreconditionFailed,
    ProviderCalendarInfo,
    ProviderError,
    ProviderIdentity,
    PushChannel,
    PushUnsupported,
    ReauthRequired,
    SyncTarget,
    TokenGrant,
    api_client,
    classify,
    oauth_error,
)
from uniffy.domains.scheduling.calendar.connections.providers.google_events import (
    parse_google_event,
)
from uniffy.infrastructure.outbound import ApiResponse

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
SCOPES = (
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
)
_TOKEN_BASE = "https://oauth2.googleapis.com"
_USERINFO_BASE = "https://openidconnect.googleapis.com"
_API_BASE = "https://www.googleapis.com/calendar/v3"
_PAGE_SIZE = 2500
_CHANNEL_TTL_SECONDS = 7 * 24 * 3600
# A long-lived calendar can hold tens of thousands of entries; this bounds one round.
_MAX_PAGES = 40
_SYSTEM_SUFFIXES = ("@group.v.calendar.google.com", "#holiday@group.v.calendar.google.com")
_ROLES = {
    "owner": ProviderAccessRole.OWNER,
    "writer": ProviderAccessRole.WRITER,
    "reader": ProviderAccessRole.READER,
    "freeBusyReader": ProviderAccessRole.FREE_BUSY,
}


def _bearer(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


def _rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _calendar_path(provider_calendar_id: str) -> str:
    return f"/calendars/{quote(provider_calendar_id, safe='')}"


def _event_path(provider_calendar_id: str, event_id: str) -> str:
    return f"{_calendar_path(provider_calendar_id)}/events/{quote(event_id, safe='')}"


class GoogleCalendarClient:
    provider = CalendarProvider.GOOGLE

    def __init__(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._token_api = api_client("google_oauth", _TOKEN_BASE)
        self._userinfo_api = api_client("google_oauth", _USERINFO_BASE)
        self._api = api_client("google_calendar", _API_BASE)

    def authorize_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str | None
    ) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            # Without it a second sign-in returns no refresh token.
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if login_hint:
            params["login_hint"] = login_hint
        return f"{AUTHORIZE_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, verifier: str, redirect_uri: str) -> TokenGrant:
        return await self._token({
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect_uri,
        })

    async def refresh(self, refresh_token: str) -> TokenGrant:
        return await self._token({"grant_type": "refresh_token", "refresh_token": refresh_token})

    async def _token(self, form: dict[str, str]) -> TokenGrant:
        response = await self._token_api.request(
            "POST",
            "/token",
            form={**form, "client_id": self._client_id, "client_secret": self._client_secret},
        )
        if not response.ok:
            raise oauth_error(response)
        return _grant(response)

    async def identity(self, grant: TokenGrant) -> ProviderIdentity:
        response = await self._userinfo_api.request(
            "GET", "/v1/userinfo", headers=_bearer(grant.access_token)
        )
        if not response.ok:
            raise classify(response)
        body = response.json() or {}
        subject = str(body.get("sub") or "")
        email = str(body.get("email") or "").strip().lower()
        if not subject or not email:
            raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="identity_incomplete")
        return ProviderIdentity(
            account_id=subject, email=email, email_verified=body.get("email_verified") is True
        )

    async def revoke(self, token: str) -> None:
        response = await self._token_api.request("POST", "/revoke", form={"token": token})
        # 400 means the token was already dead, which is what revoking wants.
        if not response.ok and response.status != 400:  # noqa: PLR2004 - HTTP status
            raise classify(response)

    async def list_calendars(self, token: str) -> list[ProviderCalendarInfo]:
        calendars: list[ProviderCalendarInfo] = []
        page_token: str | None = None
        for _page in range(_MAX_PAGES):
            response = await self._api.request(
                "GET",
                "/users/me/calendarList",
                params={"maxResults": 250, "pageToken": page_token, "showHidden": True},
                headers=_bearer(token),
            )
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            for item in body.get("items") or []:
                info = _calendar_info(item)
                if info is not None:
                    calendars.append(info)
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return calendars

    async def fetch_changes(self, token: str, target: SyncTarget, self_email: str) -> ChangeBatch:
        """Every page of one round; nothing is written until the last page has been read."""
        full = target.cursor is None
        base_params: dict[str, Any] = {"maxResults": _PAGE_SIZE, "singleEvents": False}
        # Open-ended forward: a later change to any event the first scan kept must still apply.
        if full:
            # Padded so an event starting exactly on the edge is not lost to rounding.
            base_params["timeMin"] = _rfc3339(target.window_start - timedelta(seconds=1))
        else:
            base_params["syncToken"] = target.cursor
        items: list[ProviderEvent] = []
        skipped: list[SkippedItem] = []
        page_token: str | None = None
        for _page in range(_MAX_PAGES):
            params = dict(base_params)
            if page_token:
                params["pageToken"] = page_token
            response = await self._api.request(
                "GET",
                f"{_calendar_path(target.provider_calendar_id)}/events",
                params=params,
                headers=_bearer(token),
            )
            if response.status == 410:  # noqa: PLR2004 - HTTP status
                raise CursorExpired
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            for item in body.get("items") or []:
                parsed = parse_google_event(item, self_email=self_email)
                if isinstance(parsed, SkippedItem):
                    skipped.append(parsed)
                else:
                    items.append(parsed)
            page_token = body.get("nextPageToken")
            if page_token:
                continue
            cursor = body.get("nextSyncToken")
            if not cursor:
                raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="no_sync_token")
            return ChangeBatch(
                items=tuple(items),
                skipped=tuple(skipped),
                cursor=str(cursor),
                full_scan=full,
            )
        raise ProviderError(SyncFailure.UNPROCESSABLE, reason="too_many_pages")

    async def instances(
        self,
        token: str,
        provider_calendar_id: str,
        series_id: str,
        window_start: datetime,
        window_end: datetime,
        self_email: str,
    ) -> list[ProviderEvent]:
        found: list[ProviderEvent] = []
        page_token: str | None = None
        for _page in range(_MAX_PAGES):
            response = await self._api.request(
                "GET",
                f"{_event_path(provider_calendar_id, series_id)}/instances",
                params={
                    "timeMin": _rfc3339(window_start),
                    "timeMax": _rfc3339(window_end),
                    "maxResults": _PAGE_SIZE,
                    "pageToken": page_token,
                },
                headers=_bearer(token),
            )
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            for item in body.get("items") or []:
                parsed = parse_google_event(item, self_email=self_email)
                if isinstance(parsed, ProviderEvent):
                    found.append(parsed)
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return found

    async def get_event(
        self, token: str, provider_calendar_id: str, event_id: str, self_email: str
    ) -> ProviderEvent | None:
        response = await self._api.request(
            "GET", _event_path(provider_calendar_id, event_id), headers=_bearer(token)
        )
        if response.status in (404, 410):  # noqa: PLR2004 - HTTP status
            return None
        if not response.ok:
            raise classify(response)
        return _parsed(response, self_email)

    async def create_event(
        self,
        token: str,
        provider_calendar_id: str,
        body: dict[str, Any],
        *,
        idempotency_key: str,
        self_email: str,
    ) -> ProviderEvent:
        # A client-chosen id makes a retried create land on the same event instead of a copy.
        event_id = idempotency_key.replace("-", "")
        response = await self._api.request(
            "POST",
            f"{_calendar_path(provider_calendar_id)}/events",
            params={"sendUpdates": "all"},
            json_body={**body, "id": event_id},
            headers=_bearer(token),
        )
        if response.status == 409:  # noqa: PLR2004 - HTTP status
            existing = await self.get_event(token, provider_calendar_id, event_id, self_email)
            if existing is not None and existing.kind != ItemKind.REMOVED:
                return existing
            if existing is not None:
                # Google keeps a deleted event's id; the event coming back revives it.
                return await self.update_event(
                    token,
                    provider_calendar_id,
                    event_id,
                    {**body, "status": "confirmed"},
                    etag=None,
                    self_email=self_email,
                )
        if not response.ok:
            raise classify(response)
        return _parsed(response, self_email)

    async def update_event(
        self,
        token: str,
        provider_calendar_id: str,
        event_id: str,
        body: dict[str, Any],
        *,
        etag: str | None,
        self_email: str,
    ) -> ProviderEvent:
        headers = _bearer(token)
        if etag:
            headers["if-match"] = etag
        response = await self._api.request(
            "PATCH",
            _event_path(provider_calendar_id, event_id),
            params={"sendUpdates": "all"},
            json_body=body,
            headers=headers,
        )
        if response.status == 412:  # noqa: PLR2004 - HTTP status
            raise PreconditionFailed
        if not response.ok:
            raise classify(response)
        return _parsed(response, self_email)

    async def delete_event(self, token: str, provider_calendar_id: str, event_id: str) -> None:
        response = await self._api.request(
            "DELETE",
            _event_path(provider_calendar_id, event_id),
            params={"sendUpdates": "all"},
            headers=_bearer(token),
        )
        if not response.ok and response.status not in (404, 410):  # noqa: PLR2004 - HTTP status
            raise classify(response)

    async def respond(
        self,
        token: str,
        provider_calendar_id: str,
        event_id: str,
        *,
        self_email: str,
        response_status: str,
    ) -> ProviderEvent | None:
        response = await self._api.request(
            "PATCH",
            _event_path(provider_calendar_id, event_id),
            params={"sendUpdates": "all"},
            json_body={
                "attendeesOmitted": True,
                "attendees": [{"email": self_email, "responseStatus": response_status}],
            },
            headers=_bearer(token),
        )
        if not response.ok:
            raise classify(response)
        return _parsed(response, self_email)

    async def watch(
        self, token: str, provider_calendar_id: str, *, channel_id: str, address: str, secret: str
    ) -> PushChannel:
        response = await self._api.request(
            "POST",
            f"{_calendar_path(provider_calendar_id)}/events/watch",
            json_body={
                "id": channel_id,
                "type": "web_hook",
                "address": address,
                "token": secret,
                "params": {"ttl": str(_CHANNEL_TTL_SECONDS)},
            },
            headers=_bearer(token),
        )
        if not response.ok:
            if _reason(response) == "pushNotSupportedForRequestedResource":  # noqa: PLR2004 - API reason
                raise PushUnsupported
            raise classify(response)
        body = response.json() or {}
        expiration = body.get("expiration")
        expires_at = (
            datetime.fromtimestamp(int(expiration) / 1000, tz=UTC)
            if isinstance(expiration, (str, int)) and str(expiration).isdigit()
            else datetime.now(UTC) + timedelta(seconds=_CHANNEL_TTL_SECONDS)
        )
        return PushChannel(
            channel_id=channel_id,
            resource_id=str(body.get("resourceId") or ""),
            expires_at=expires_at,
        )

    async def stop_channel(self, token: str, channel_id: str, resource_id: str | None) -> None:
        response = await self._api.request(
            "POST",
            "/channels/stop",
            json_body={"id": channel_id, "resourceId": resource_id or ""},
            headers=_bearer(token),
        )
        # A channel that already expired answers 404, which is the outcome stopping wants.
        if not response.ok and response.status != 404:  # noqa: PLR2004 - HTTP status
            raise classify(response)


def _parsed(response: ApiResponse, self_email: str) -> ProviderEvent:
    parsed = parse_google_event(response.json() or {}, self_email=self_email)
    if not isinstance(parsed, ProviderEvent):
        raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="unreadable_event")
    return parsed


def _reason(response: ApiResponse) -> str | None:
    body = response.json()
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return None
    for item in error.get("errors") or []:
        if isinstance(item, dict) and item.get("reason"):
            return str(item["reason"])
    return None


def _calendar_info(item: dict[str, Any]) -> ProviderCalendarInfo | None:
    calendar_id = item.get("id")
    role = _ROLES.get(str(item.get("accessRole")))
    if not isinstance(calendar_id, str) or not calendar_id or role is None:
        return None
    name = str(item.get("summaryOverride") or item.get("summary") or calendar_id)
    return ProviderCalendarInfo(
        provider_calendar_id=calendar_id,
        name=name[:255],
        color=_color(item.get("backgroundColor")),
        access_role=role,
        is_primary=item.get("primary") is True,
        is_system=calendar_id.endswith(_SYSTEM_SUFFIXES),
    )


def _color(value: Any) -> str | None:
    if isinstance(value, str) and value.startswith("#") and len(value) in (4, 7):  # noqa: PLR2004 - hex colour
        return value.lower()
    return None


def _grant(response: ApiResponse) -> TokenGrant:
    body = response.json() or {}
    access = body.get("access_token")
    if not isinstance(access, str) or not access:
        raise ReauthRequired("no_access_token")
    return TokenGrant(
        access_token=access,
        expires_in=int(body.get("expires_in") or 3600),
        refresh_token=body.get("refresh_token") or None,
        scope=str(body.get("scope") or ""),
        id_token=body.get("id_token") or None,
    )
