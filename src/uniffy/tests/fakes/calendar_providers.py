"""In-memory Google Calendar and Microsoft Graph, served to ``ApiClient`` through ASGI."""

import itertools
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pyqwest.testing import ASGITransport

from uniffy.core.json_codec import loads

GOOGLE_HOSTS = {"oauth2.googleapis.com", "openidconnect.googleapis.com", "www.googleapis.com"}
MICROSOFT_HOSTS = {"login.microsoftonline.com", "graph.microsoft.com"}


def _now() -> datetime:
    return datetime.now(UTC)


def _rfc3339(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


@dataclass
class Calls:
    """Every request, so a test can assert what reached the provider."""

    log: list[tuple[str, str, str]] = field(default_factory=list)

    def count(self, method: str, path_part: str) -> int:
        return sum(1 for m, _host, path in self.log if m == method and path_part in path)


@dataclass
class _Tokens:
    codes: dict[str, str] = field(default_factory=dict)
    refresh_tokens: set[str] = field(default_factory=set)
    access_tokens: set[str] = field(default_factory=set)
    refresh_calls: int = 0
    revoked: list[str] = field(default_factory=list)

    def issue(self) -> dict[str, Any]:
        access = f"access-{secrets.token_hex(8)}"
        refresh = f"refresh-{secrets.token_hex(8)}"
        self.access_tokens.add(access)
        self.refresh_tokens.add(refresh)
        return {"access_token": access, "refresh_token": refresh, "expires_in": 3600}


class FakeGoogle:
    def __init__(self, email: str = "uniffy.dev.test1@gmail.com", subject: str = "google-sub-1"):
        self.email = email
        self.subject = subject
        self.calls = Calls()
        self.tokens = _Tokens()
        self.seq = itertools.count(1)
        self.position = 0
        self.calendars: dict[str, dict[str, Any]] = {
            email: {
                "id": email,
                "summary": email,
                "accessRole": "owner",
                "primary": True,
                "backgroundColor": "#9fe1e7",
            },
        }
        self.events: dict[str, dict[str, dict[str, Any]]] = {email: {}}
        self.instances: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.expired_tokens: set[str] = set()
        self.drop_next_insert = False
        self.rate_limit_next = False
        self.channels: dict[str, dict[str, Any]] = {}
        self.app = self._build()

    def _bump(self) -> int:
        self.position = next(self.seq)
        return self.position

    def put_event(self, calendar_id: str, event: dict[str, Any]) -> dict[str, Any]:
        """A change made on the provider side, as another client would."""
        seq = self._bump()
        stored = {
            "kind": "calendar#event",
            "status": "confirmed",
            "iCalUID": f"{event['id']}@google.com",
            "organizer": {"email": self.email, "self": True},
            **event,
            "etag": f'"{seq}"',
            "updated": _rfc3339(_now() + timedelta(milliseconds=seq)),
            "_seq": seq,
        }
        self.events.setdefault(calendar_id, {})[event["id"]] = stored
        return stored

    def cancel_event(self, calendar_id: str, event_id: str) -> None:
        event = self.events[calendar_id][event_id]
        seq = self._bump()
        event.update(status="cancelled", etag=f'"{seq}"', _seq=seq, updated=_rfc3339(_now()))

    def _public(self, event: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in event.items() if not key.startswith("_")}

    def _build(self) -> FastAPI:
        app = FastAPI()
        fake = self

        @app.post("/token")
        async def token(request: Request) -> Response:
            form = dict((await request.form()).items())
            if form.get("grant_type") == "authorization_code":
                if form.get("code") not in fake.tokens.codes:
                    return JSONResponse({"error": "invalid_grant"}, status_code=400)
                body = fake.tokens.issue()
                body["scope"] = "openid email https://www.googleapis.com/auth/calendar.events"
                return JSONResponse(body)
            fake.tokens.refresh_calls += 1
            if form.get("refresh_token") not in fake.tokens.refresh_tokens:
                return JSONResponse({"error": "invalid_grant"}, status_code=400)
            access = f"access-{secrets.token_hex(8)}"
            fake.tokens.access_tokens.add(access)
            return JSONResponse({"access_token": access, "expires_in": 3600})

        @app.post("/revoke")
        async def revoke(request: Request) -> Response:
            fake.tokens.revoked.append(str((await request.form()).get("token")))
            return Response(status_code=200)

        @app.get("/v1/userinfo")
        async def userinfo() -> Response:
            return JSONResponse({"sub": fake.subject, "email": fake.email, "email_verified": True})

        @app.get("/calendar/v3/users/me/calendarList")
        async def calendar_list() -> Response:
            return JSONResponse({"items": list(fake.calendars.values())})

        @app.get("/calendar/v3/calendars/{calendar_id}/events")
        async def list_events(calendar_id: str, request: Request) -> Response:
            if fake.rate_limit_next:
                fake.rate_limit_next = False
                return JSONResponse(
                    {"error": {"errors": [{"reason": "rateLimitExceeded"}]}},
                    status_code=429,
                    headers={"retry-after": "30"},
                )
            params = request.query_params
            token = params.get("syncToken")
            if token in fake.expired_tokens:
                return JSONResponse({"error": {"code": 410}}, status_code=410)
            events = list(fake.events.get(calendar_id, {}).values())
            if token is not None:
                since = int(token)
                chosen = [event for event in events if event["_seq"] > since]
            else:
                chosen = [event for event in events if event["status"] != "cancelled"]
            return JSONResponse({
                "items": [fake._public(event) for event in chosen],
                "nextSyncToken": str(fake.position),
            })

        @app.get("/calendar/v3/calendars/{calendar_id}/events/{event_id}/instances")
        async def list_instances(calendar_id: str, event_id: str) -> Response:
            return JSONResponse({"items": fake.instances.get((calendar_id, event_id), [])})

        @app.get("/calendar/v3/calendars/{calendar_id}/events/{event_id}")
        async def get_event(calendar_id: str, event_id: str) -> Response:
            event = fake.events.get(calendar_id, {}).get(event_id)
            if event is None or event["status"] == "cancelled":
                return JSONResponse({"error": {"code": 404}}, status_code=404)
            return JSONResponse(fake._public(event))

        @app.post("/calendar/v3/calendars/{calendar_id}/events")
        async def insert(calendar_id: str, request: Request) -> Response:
            body = loads(await request.body())
            if body["id"] in fake.events.get(calendar_id, {}):
                return JSONResponse({"error": {"code": 409}}, status_code=409)
            stored = fake.put_event(calendar_id, body)
            if fake.drop_next_insert:
                fake.drop_next_insert = False
                return JSONResponse({"error": {"code": 503}}, status_code=503)
            return JSONResponse(fake._public(stored))

        @app.patch("/calendar/v3/calendars/{calendar_id}/events/{event_id}")
        async def patch(calendar_id: str, event_id: str, request: Request) -> Response:
            event = fake.events.get(calendar_id, {}).get(event_id)
            if event is None:
                return JSONResponse({"error": {"code": 404}}, status_code=404)
            expected = request.headers.get("if-match")
            if expected and expected != event["etag"]:
                return JSONResponse({"error": {"code": 412}}, status_code=412)
            body = loads(await request.body())
            if request.query_params.get("attendeesOmitted") == "true":
                for attendee in event.get("attendees", []):
                    for change in body.get("attendees", []):
                        if attendee.get("email") == change.get("email"):
                            attendee["responseStatus"] = change["responseStatus"]
                body = {}
            merged = {**event, **body, "id": event_id}
            stored = fake.put_event(calendar_id, merged)
            return JSONResponse(fake._public(stored))

        @app.delete("/calendar/v3/calendars/{calendar_id}/events/{event_id}")
        async def remove(calendar_id: str, event_id: str) -> Response:
            if event_id not in fake.events.get(calendar_id, {}):
                return Response(status_code=404)
            fake.cancel_event(calendar_id, event_id)
            return Response(status_code=204)

        @app.post("/calendar/v3/calendars/{calendar_id}/events/watch")
        async def watch(calendar_id: str, request: Request) -> Response:
            body = loads(await request.body())
            fake.channels[body["id"]] = {"calendar": calendar_id, "token": body["token"]}
            expiration = int((_now() + timedelta(days=7)).timestamp() * 1000)
            return JSONResponse({"resourceId": f"res-{body['id']}", "expiration": str(expiration)})

        @app.post("/calendar/v3/channels/stop")
        async def stop(request: Request) -> Response:
            fake.channels.pop(loads(await request.body())["id"], None)
            return Response(status_code=204)

        return app


class FakeGraph:
    def __init__(
        self,
        email: str = "uniffy.dev.test1@outlook.com",
        object_id: str = "graph-oid-1",
        tenant_id: str = "9188040d-6c67-4c5b-b112-36a304b66dad",
    ):
        self.email = email
        self.object_id = object_id
        self.tenant_id = tenant_id
        self.calls = Calls()
        self.tokens = _Tokens()
        self.seq = itertools.count(1)
        self.position = 0
        self.calendars: dict[str, dict[str, Any]] = {
            "cal-primary": {
                "id": "cal-primary",
                "name": "Calendar",
                "canEdit": True,
                "isDefaultCalendar": True,
                "hexColor": "#0078d4",
                "isRemovable": False,
            },
        }
        self.events: dict[str, dict[str, Any]] = {}
        self.instances: dict[str, list[dict[str, Any]]] = {}
        self.transactions: dict[str, str] = {}
        self.expired_links: set[str] = set()
        self.drop_next_create = False
        self.subscriptions: dict[str, dict[str, Any]] = {}
        self.app = self._build()

    def put_event(self, event: dict[str, Any], calendar_id: str = "cal-primary") -> dict[str, Any]:
        seq = next(self.seq)
        self.position = seq
        stored = {
            "type": "singleInstance",
            "iCalUId": f"0400000082-{event['id']}",
            "isOrganizer": True,
            "isAllDay": False,
            "isCancelled": False,
            "organizer": {"emailAddress": {"address": self.email, "name": "Test"}},
            **event,
            "@odata.etag": f'W/"{seq}"',
            "lastModifiedDateTime": _rfc3339(_now() + timedelta(milliseconds=seq)),
            "_seq": seq,
            "_calendar": calendar_id,
            "_removed": False,
        }
        self.events[event["id"]] = stored
        return stored

    def remove_event(self, event_id: str) -> None:
        seq = next(self.seq)
        self.position = seq
        self.events[event_id].update(_removed=True, _seq=seq)

    def _public(self, event: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in event.items() if not key.startswith("_")}

    def id_token(self) -> str:
        import base64

        from uniffy.core.json_codec import dumps_bytes

        payload = base64.urlsafe_b64encode(dumps_bytes({"tid": self.tenant_id})).rstrip(b"=")
        return f"e30.{payload.decode()}.sig"

    def _build(self) -> FastAPI:
        app = FastAPI()
        fake = self

        @app.post("/{tenant}/oauth2/v2.0/token")
        async def token(tenant: str, request: Request) -> Response:
            form = dict((await request.form()).items())
            if form.get("grant_type") == "authorization_code":
                if form.get("code") not in fake.tokens.codes:
                    return JSONResponse({"error": "invalid_grant"}, status_code=400)
                body = fake.tokens.issue()
                body.update(
                    scope="openid email profile offline_access User.Read Calendars.ReadWrite",
                    id_token=fake.id_token(),
                )
                return JSONResponse(body)
            fake.tokens.refresh_calls += 1
            if form.get("refresh_token") not in fake.tokens.refresh_tokens:
                return JSONResponse({"error": "invalid_grant"}, status_code=400)
            # Microsoft rotates the refresh token on every use.
            fake.tokens.refresh_tokens.discard(str(form.get("refresh_token")))
            return JSONResponse(fake.tokens.issue())

        @app.get("/v1.0/me")
        async def me() -> Response:
            return JSONResponse({
                "id": fake.object_id,
                "mail": fake.email,
                "userPrincipalName": fake.email,
            })

        @app.get("/v1.0/me/calendars")
        async def calendars() -> Response:
            return JSONResponse({"value": list(fake.calendars.values())})

        def _view(calendar_id: str | None, since: int | None) -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            for event in fake.events.values():
                if calendar_id is not None and event["_calendar"] != calendar_id:
                    continue
                if since is not None and event["_seq"] <= since:
                    continue
                if event["_removed"]:
                    if since is not None:
                        out.append({"id": event["id"], "@removed": {"reason": "deleted"}})
                    continue
                if event["type"] == "seriesMaster":
                    out.extend(fake.instances.get(event["id"], []))
                else:
                    out.append(fake._public(event))
            return out

        @app.get("/v1.0/me/calendarView/delta")
        async def delta(request: Request) -> Response:
            token = request.query_params.get("$deltatoken")
            if token is not None and token in fake.expired_links:
                return JSONResponse({"error": {"code": "SyncStateNotFound"}}, status_code=410)
            since = int(token) if token is not None else None
            link = (
                f"https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken={fake.position}"
            )
            return JSONResponse({"value": _view("cal-primary", since), "@odata.deltaLink": link})

        @app.get("/v1.0/me/calendars/{calendar_id}/calendarView")
        async def calendar_view(calendar_id: str) -> Response:
            return JSONResponse({"value": _view(calendar_id, None)})

        @app.get("/v1.0/me/calendars/{calendar_id}/events/{event_id}/instances")
        async def instances(event_id: str) -> Response:
            return JSONResponse({"value": fake.instances.get(event_id, [])})

        @app.get("/v1.0/me/calendars/{calendar_id}/events/{event_id}")
        async def get_event(event_id: str) -> Response:
            event = fake.events.get(event_id)
            if event is None or event["_removed"]:
                return JSONResponse({"error": {"code": "ErrorItemNotFound"}}, status_code=404)
            return JSONResponse(fake._public(event))

        @app.post("/v1.0/me/calendars/{calendar_id}/events")
        async def create(calendar_id: str, request: Request) -> Response:
            body = loads(await request.body())
            transaction = body.get("transactionId")
            if transaction in fake.transactions:
                return JSONResponse(
                    fake._public(fake.events[fake.transactions[transaction]]), status_code=201
                )
            event_id = f"AAMk-{secrets.token_hex(6)}"
            stored = fake.put_event({**body, "id": event_id}, calendar_id)
            if transaction:
                fake.transactions[transaction] = event_id
            if fake.drop_next_create:
                fake.drop_next_create = False
                return JSONResponse({"error": {"code": "ServiceUnavailable"}}, status_code=503)
            return JSONResponse(fake._public(stored), status_code=201)

        @app.patch("/v1.0/me/calendars/{calendar_id}/events/{event_id}")
        async def patch(event_id: str, request: Request) -> Response:
            event = fake.events.get(event_id)
            if event is None or event["_removed"]:
                return JSONResponse({"error": {"code": "ErrorItemNotFound"}}, status_code=404)
            expected = request.headers.get("if-match")
            if expected and expected != event["@odata.etag"]:
                return JSONResponse(
                    {"error": {"code": "ErrorIrresolvableConflict"}}, status_code=412
                )
            body = loads(await request.body())
            stored = fake.put_event(
                {**fake._public(event), **body, "id": event_id}, event["_calendar"]
            )
            return JSONResponse(fake._public(stored))

        @app.delete("/v1.0/me/calendars/{calendar_id}/events/{event_id}")
        async def remove(event_id: str) -> Response:
            if event_id not in fake.events:
                return Response(status_code=404)
            fake.remove_event(event_id)
            return Response(status_code=204)

        @app.post("/v1.0/me/calendars/{calendar_id}/events/{event_id}/{action}")
        async def respond(event_id: str, action: str) -> Response:
            event = fake.events[event_id]
            words = {
                "accept": "accepted",
                "tentativelyAccept": "tentativelyAccepted",
                "decline": "declined",
            }
            event["responseStatus"] = {"response": words[action]}
            for attendee in event.get("attendees", []):
                if attendee["emailAddress"]["address"] == fake.email:
                    attendee["status"] = {"response": words[action]}
            fake.put_event(fake._public(event), event["_calendar"])
            return Response(status_code=202)

        @app.post("/v1.0/subscriptions")
        async def subscribe(request: Request) -> Response:
            body = loads(await request.body())
            subscription_id = f"sub-{secrets.token_hex(4)}"
            fake.subscriptions[subscription_id] = body
            return JSONResponse({"id": subscription_id, **body}, status_code=201)

        @app.patch("/v1.0/subscriptions/{subscription_id}")
        async def renew(subscription_id: str, request: Request) -> Response:
            fake.subscriptions[subscription_id].update(loads(await request.body()))
            return JSONResponse(fake.subscriptions[subscription_id])

        @app.delete("/v1.0/subscriptions/{subscription_id}")
        async def unsubscribe(subscription_id: str) -> Response:
            fake.subscriptions.pop(subscription_id, None)
            return Response(status_code=204)

        return app


class FakeProviders:
    """One transport for both fakes, routed by the Host header the client sends."""

    def __init__(self) -> None:
        self.google = FakeGoogle()
        self.graph = FakeGraph()

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        headers = {key.decode(): value.decode() for key, value in scope.get("headers", [])}
        host = headers.get("host", "").split(":")[0]
        if host in GOOGLE_HOSTS:
            self.google.calls.log.append((scope["method"], host, scope["path"]))
            await self.google.app(scope, receive, send)
        elif host in MICROSOFT_HOSTS:
            self.graph.calls.log.append((scope["method"], host, scope["path"]))
            await self.graph.app(scope, receive, send)
        else:
            await PlainTextResponse("unknown host", status_code=599)(scope, receive, send)

    def transport(self) -> ASGITransport:
        return ASGITransport(self)
