"""Microsoft Graph calendars and the Microsoft identity platform over their fixed hosts."""

import base64
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

from uniffy.core.json_codec import JSONDecodeError, loads
from uniffy.core.models.calendar.connection import CalendarProvider, ProviderAccessRole, SyncFailure
from uniffy.core.outbound import ApiResponse
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
    ReauthRequired,
    SyncTarget,
    TokenGrant,
    api_client,
    classify,
    oauth_error,
)
from uniffy.domains.scheduling.calendar.connections.providers.microsoft_events import (
    parse_graph_event,
)
from uniffy.domains.scheduling.calendar.connections.recurrence import (
    reconcile_instances,
    series_rule,
)

LOGIN_BASE = "https://login.microsoftonline.com"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
SCOPES = ("openid", "email", "profile", "offline_access", "User.Read", "Calendars.ReadWrite")
# Personal Microsoft accounts all sign in through this one tenant.
CONSUMER_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad"
_PAGE_SIZE = 200
# Outlook event subscriptions live at most 10,080 minutes; renewal starts a day before.
_SUBSCRIPTION_LIFETIME = timedelta(days=6)
# calendarView expands every instance, so a busy shared calendar needs many pages.
_MAX_PAGES = 500
_RSVP_ACTIONS = {
    "accepted": "accept",
    "tentative": "tentativelyAccept",
    "declined": "decline",
}
_CURSOR_ERRORS = frozenset({"SyncStateNotFound", "ErrorInvalidSyncStateData", "SyncStateInvalid"})
# Ids that survive moves between folders, and times in UTC so no Windows zone names reach us.
_PREFER = ", ".join((
    'IdType="ImmutableId"',
    'outlook.timezone="UTC"',
    'outlook.body-content-type="text"',
    f"odata.maxpagesize={_PAGE_SIZE}",
))


def _headers(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}", "prefer": _PREFER}


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _event_path(provider_calendar_id: str, event_id: str) -> str:
    # Addressed through its calendar: /me/events reaches only the signed-in mailbox, not a
    # calendar another mailbox shared with it.
    return f"/me/calendars/{_segment(provider_calendar_id)}/events/{_segment(event_id)}"


def _segment(value: str) -> str:
    return quote(value, safe="")


class MicrosoftCalendarClient:
    provider = CalendarProvider.MICROSOFT

    def __init__(self, client_id: str, client_secret: str, tenant: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._tenant = _segment(tenant or "common")
        self._login = api_client("microsoft_oauth", LOGIN_BASE)
        self._graph = api_client("microsoft_graph", GRAPH_BASE)

    def authorize_url(
        self, *, state: str, code_challenge: str, redirect_uri: str, login_hint: str | None
    ) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "response_mode": "query",
            "scope": " ".join(SCOPES),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        if login_hint:
            params["login_hint"] = login_hint
        else:
            params["prompt"] = "select_account"
        return f"{LOGIN_BASE}/{self._tenant}/oauth2/v2.0/authorize?{urlencode(params)}"

    async def exchange_code(self, code: str, verifier: str, redirect_uri: str) -> TokenGrant:
        return await self._token({
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect_uri,
            "scope": " ".join(SCOPES),
        })

    async def refresh(self, refresh_token: str) -> TokenGrant:
        return await self._token({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": " ".join(SCOPES),
        })

    async def _token(self, form: dict[str, str]) -> TokenGrant:
        response = await self._login.request(
            "POST",
            f"/{self._tenant}/oauth2/v2.0/token",
            form={**form, "client_id": self._client_id, "client_secret": self._client_secret},
        )
        if not response.ok:
            raise oauth_error(response)
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

    async def identity(self, grant: TokenGrant) -> ProviderIdentity:
        response = await self._graph.request(
            "GET",
            "/me",
            params={"$select": "id,mail,userPrincipalName"},
            headers={"authorization": f"Bearer {grant.access_token}"},
        )
        if not response.ok:
            raise classify(response)
        body = response.json() or {}
        object_id = str(body.get("id") or "")
        email = str(body.get("mail") or body.get("userPrincipalName") or "").strip().lower()
        tenant_id = _tenant_from_id_token(grant.id_token)
        if not object_id or not email:
            raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="identity_incomplete")
        return ProviderIdentity(
            account_id=f"{tenant_id or 'unknown'}:{object_id}",
            email=email,
            # A work tenant's admin sets ``mail`` freely; only a personal account owns its address.
            email_verified=tenant_id == CONSUMER_TENANT_ID,
        )

    async def revoke(self, token: str) -> None:
        # The identity platform has no revoke endpoint; dropping the tokens is the disconnect.
        return None

    async def list_calendars(self, token: str) -> list[ProviderCalendarInfo]:
        calendars: list[ProviderCalendarInfo] = []
        link: str | None = "/me/calendars"
        params: dict[str, Any] | None = {
            "$select": "id,name,hexColor,canEdit,isDefaultCalendar,isRemovable,owner"
        }
        for _page in range(_MAX_PAGES):
            if link is None:
                break
            response = await self._graph.request("GET", link, params=params, headers=_headers(token))
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            for item in body.get("value") or []:
                info = _calendar_info(item)
                if info is not None:
                    calendars.append(info)
            link = body.get("@odata.nextLink")
            params = None
        return calendars

    async def fetch_changes(self, token: str, target: SyncTarget, self_email: str) -> ChangeBatch:
        # v1.0 tracks changes only for the default calendar; the others are read whole each time.
        if target.is_primary:
            return await self._delta(token, target, self_email)
        return await self._snapshot(token, target, self_email)

    async def _delta(self, token: str, target: SyncTarget, self_email: str) -> ChangeBatch:
        full = target.cursor is None
        link: str = target.cursor or "/me/calendarView/delta"
        params: dict[str, Any] | None = None
        if full:
            params = {
                "startDateTime": _iso(target.window_start),
                "endDateTime": _iso(target.window_end),
            }
        items: list[ProviderEvent] = []
        skipped: list[SkippedItem] = []
        for _page in range(_MAX_PAGES):
            response = await self._graph.request("GET", link, params=params, headers=_headers(token))
            if response.status == 410 or _cursor_error(response):  # noqa: PLR2004 - HTTP status
                raise CursorExpired
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            _collect(body.get("value") or [], items, skipped, self_email)
            params = None
            next_link = body.get("@odata.nextLink")
            if next_link:
                link = str(next_link)
                continue
            delta_link = body.get("@odata.deltaLink")
            if not delta_link:
                raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="no_delta_link")
            return await self._shape(
                token, target, self_email, items, skipped, str(delta_link), full_scan=full
            )
        raise ProviderError(SyncFailure.UNPROCESSABLE, reason="too_many_pages")

    async def _snapshot(self, token: str, target: SyncTarget, self_email: str) -> ChangeBatch:
        link = f"/me/calendars/{_segment(target.provider_calendar_id)}/calendarView"
        params: dict[str, Any] | None = {
            "startDateTime": _iso(target.window_start),
            "endDateTime": _iso(target.window_end),
            "$top": _PAGE_SIZE,
        }
        items: list[ProviderEvent] = []
        skipped: list[SkippedItem] = []
        for _page in range(_MAX_PAGES):
            response = await self._graph.request("GET", link, params=params, headers=_headers(token))
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            _collect(body.get("value") or [], items, skipped, self_email)
            params = None
            next_link = body.get("@odata.nextLink")
            if not next_link:
                return await self._shape(
                    token, target, self_email, items, skipped, None, full_scan=True
                )
            link = str(next_link)
        raise ProviderError(SyncFailure.UNPROCESSABLE, reason="too_many_pages")

    async def _shape(
        self,
        token: str,
        target: SyncTarget,
        self_email: str,
        items: list[ProviderEvent],
        skipped: list[SkippedItem],
        cursor: str | None,
        *,
        full_scan: bool,
    ) -> ChangeBatch:
        """Turn expanded instances back into series: the master, its exceptions, its gaps."""
        series_ids = {item.series_id for item in items if item.series_id}
        shaped = [item for item in items if not item.series_id]
        mirrored: dict[str, tuple[ProviderEvent, ...]] = {}
        complete: set[str] = set()
        for series_id in sorted(series_ids):
            master = await self.get_event(token, target.provider_calendar_id, series_id, self_email)
            if master is None:
                shaped.append(ProviderEvent(provider_event_id=series_id, kind=ItemKind.REMOVED))
                continue
            instances = await self.instances(
                token,
                target.provider_calendar_id,
                series_id,
                target.window_start,
                target.window_end,
                self_email,
            )
            rule = series_rule(master)
            shaped.append(master)
            if rule is None:
                mirrored[series_id] = tuple(instances)
                continue
            mapping, _exdates = rule
            cancelled, overrides = reconcile_instances(
                master, mapping, instances, target.window_start, target.window_end
            )
            shaped.extend(overrides)
            shaped.extend(
                ProviderEvent(
                    provider_event_id=f"{series_id}:{day.isoformat()}",
                    kind=ItemKind.CANCELLED_OCCURRENCE,
                    series_id=series_id,
                    original_date=day,
                )
                for day in cancelled
            )
            complete.add(series_id)
        return ChangeBatch(
            items=tuple(shaped),
            skipped=tuple(skipped),
            cursor=cursor,
            full_scan=full_scan,
            mirrored=mirrored,
            complete_series=frozenset(complete),
        )

    async def get_event(
        self, token: str, provider_calendar_id: str, event_id: str, self_email: str
    ) -> ProviderEvent | None:
        response = await self._graph.request(
            "GET", _event_path(provider_calendar_id, event_id), headers=_headers(token)
        )
        if response.status == 404:  # noqa: PLR2004 - HTTP status
            return None
        if not response.ok:
            raise classify(response)
        parsed = parse_graph_event(response.json() or {}, self_email=self_email)
        return parsed if isinstance(parsed, ProviderEvent) else None

    async def instances(
        self,
        token: str,
        provider_calendar_id: str,
        series_id: str,
        window_start: datetime,
        window_end: datetime,
        self_email: str,
    ) -> list[ProviderEvent]:
        link = f"{_event_path(provider_calendar_id, series_id)}/instances"
        params: dict[str, Any] | None = {
            "startDateTime": _iso(window_start),
            "endDateTime": _iso(window_end),
            "$top": _PAGE_SIZE,
        }
        found: list[ProviderEvent] = []
        for _page in range(_MAX_PAGES):
            response = await self._graph.request("GET", link, params=params, headers=_headers(token))
            if not response.ok:
                raise classify(response)
            body = response.json() or {}
            for item in body.get("value") or []:
                parsed = parse_graph_event(item, self_email=self_email)
                if isinstance(parsed, ProviderEvent):
                    found.append(parsed)
            params = None
            next_link = body.get("@odata.nextLink")
            if not next_link:
                break
            link = str(next_link)
        return found

    async def create_event(
        self,
        token: str,
        provider_calendar_id: str,
        body: dict[str, Any],
        *,
        idempotency_key: str,
        self_email: str,
    ) -> ProviderEvent:
        # Graph answers a repeated transactionId with the event it already made.
        response = await self._graph.request(
            "POST",
            f"/me/calendars/{_segment(provider_calendar_id)}/events",
            json_body={**body, "transactionId": idempotency_key},
            headers=_headers(token),
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
        headers = _headers(token)
        if etag:
            headers["if-match"] = etag
        response = await self._graph.request(
            "PATCH", _event_path(provider_calendar_id, event_id), json_body=body, headers=headers
        )
        if response.status == 412:  # noqa: PLR2004 - HTTP status
            raise PreconditionFailed
        if not response.ok:
            raise classify(response)
        return _parsed(response, self_email)

    async def delete_event(self, token: str, provider_calendar_id: str, event_id: str) -> None:
        response = await self._graph.request(
            "DELETE", _event_path(provider_calendar_id, event_id), headers=_headers(token)
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
        action = _RSVP_ACTIONS.get(response_status)
        if action is None:
            return None
        response = await self._graph.request(
            "POST",
            f"{_event_path(provider_calendar_id, event_id)}/{action}",
            json_body={"sendResponse": True},
            headers=_headers(token),
        )
        if not response.ok:
            raise classify(response)
        return await self.get_event(token, provider_calendar_id, event_id, self_email)

    async def watch(
        self, token: str, provider_calendar_id: str, *, channel_id: str, address: str, secret: str
    ) -> PushChannel:
        expires_at = datetime.now(UTC) + _SUBSCRIPTION_LIFETIME
        response = await self._graph.request(
            "POST",
            "/subscriptions",
            json_body={
                "changeType": "created,updated,deleted",
                "notificationUrl": address,
                "lifecycleNotificationUrl": address,
                "resource": f"me/calendars/{provider_calendar_id}/events",
                "expirationDateTime": _iso(expires_at),
                "clientState": secret,
            },
            headers={"authorization": f"Bearer {token}"},
        )
        if not response.ok:
            raise classify(response)
        body = response.json() or {}
        subscription_id = str(body.get("id") or "")
        if not subscription_id:
            raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="no_subscription_id")
        return PushChannel(
            channel_id=subscription_id, resource_id=subscription_id, expires_at=expires_at
        )

    async def renew_channel(self, token: str, channel_id: str) -> datetime:
        expires_at = datetime.now(UTC) + _SUBSCRIPTION_LIFETIME
        response = await self._graph.request(
            "PATCH",
            f"/subscriptions/{_segment(channel_id)}",
            json_body={"expirationDateTime": _iso(expires_at)},
            headers={"authorization": f"Bearer {token}"},
        )
        if not response.ok:
            raise classify(response)
        return expires_at

    async def stop_channel(self, token: str, channel_id: str, resource_id: str | None) -> None:
        response = await self._graph.request(
            "DELETE",
            f"/subscriptions/{_segment(channel_id)}",
            headers={"authorization": f"Bearer {token}"},
        )
        if not response.ok and response.status != 404:  # noqa: PLR2004 - HTTP status
            raise classify(response)


def _parsed(response: ApiResponse, self_email: str) -> ProviderEvent:
    parsed = parse_graph_event(response.json() or {}, self_email=self_email)
    if not isinstance(parsed, ProviderEvent):
        raise ProviderError(SyncFailure.PROVIDER_ERROR, reason="unreadable_event")
    return parsed


def _collect(
    values: list[Any], items: list[ProviderEvent], skipped: list[SkippedItem], self_email: str
) -> None:
    for value in values:
        if not isinstance(value, dict):
            continue
        parsed = parse_graph_event(value, self_email=self_email)
        if isinstance(parsed, SkippedItem):
            skipped.append(parsed)
        else:
            items.append(parsed)


def _cursor_error(response: ApiResponse) -> bool:
    if response.ok:
        return False
    body = response.json()
    if not isinstance(body, dict) or not isinstance(body.get("error"), dict):
        return False
    return str(body["error"].get("code")) in _CURSOR_ERRORS


def _calendar_info(item: dict[str, Any]) -> ProviderCalendarInfo | None:
    calendar_id = item.get("id")
    if not isinstance(calendar_id, str) or not calendar_id:
        return None
    is_default = item.get("isDefaultCalendar") is True
    role = (
        ProviderAccessRole.OWNER
        if is_default
        else (
            ProviderAccessRole.WRITER if item.get("canEdit") is True else ProviderAccessRole.READER
        )
    )
    color = item.get("hexColor")
    return ProviderCalendarInfo(
        provider_calendar_id=calendar_id,
        name=str(item.get("name") or "Calendar")[:255],
        color=color.lower() if isinstance(color, str) and color.startswith("#") else None,
        access_role=role,
        is_primary=is_default,
        # Birthdays and holiday calendars cannot be removed and are generated by the service.
        is_system=item.get("isRemovable") is False and not is_default,
    )


def _tenant_from_id_token(id_token: str | None) -> str | None:
    """The ``tid`` claim; read unverified because the token came straight from the token endpoint."""
    if not id_token or id_token.count(".") != 2:  # noqa: PLR2004 - JWT shape
        return None
    payload = id_token.split(".")[1]
    try:
        claims = loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except ValueError, JSONDecodeError:
        return None
    tid = claims.get("tid") if isinstance(claims, dict) else None
    return str(tid) if tid else None
