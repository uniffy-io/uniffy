"""Fresh PostgreSQL access for attached clients: disclosure, rechecks and revocation."""

import contextlib
from collections.abc import Awaitable, Callable, Mapping, Sequence
from uuid import UUID

from uniffy.core.auth.permissions import role_can_edit, role_can_view
from uniffy.core.auth.permissions.batching import FreshAudience
from uniffy.core.auth.permissions.checker import PermissionChecker
from uniffy.core.realtime.adapter import get_realtime_adapter
from uniffy.core.realtime.auth import WS_CLOSE_FORBIDDEN, WS_CLOSE_TOKEN_REVOKED
from uniffy.core.realtime.fanout import enqueue_for_handle
from uniffy.core.realtime.metrics import REALTIME_PERMISSION_REJECTIONS_TOTAL
from uniffy.core.realtime.state import ClientHandle, DocKey, YDocSession
from uniffy.core.realtime.wire import create_auth_denied_message
from uniffy.core.types import ContentRole
from uniffy.infrastructure.database.session import open_session


class AccessGates:
    """Applies each fresh role to the handles of resident documents.

    A failed lookup raises and stops disclosure; it never turns an outage into revocation.
    """

    def __init__(
        self,
        sessions: Mapping[DocKey, YDocSession],
        *,
        release: Callable[[DocKey, int], Awaitable[None]],
        reelect_seeder: Callable[[YDocSession], Awaitable[None]],
    ) -> None:
        self._sessions = sessions
        self._release = release
        self._reelect_seeder = reelect_seeder
        self._outbound_audience = FreshAudience(self._resolve_outbound_audience)

    async def authorize_outbound(self, key: DocKey, user_id: UUID) -> None:
        """Re-read the recipient's role before a frame for ``key`` leaves the process."""
        session, role = await self._outbound_audience.check(key, user_id)
        if self._sessions.get(key) is not session:
            raise RuntimeError("Document changed before disclosure")
        for handle in list(session.clients.values()):
            if handle.user_id == user_id and not handle.closed:
                await self._apply_role(session, handle, role)

    async def recheck(self, keys: Sequence[DocKey], user_id: UUID | None) -> None:
        """Re-run authorization for attached clients; ``user_id`` narrows to that user's handles.

        One checker per call so authorization facts load once per user and policy row,
        not once per handle.
        """
        targets: list[tuple[YDocSession, list[ClientHandle]]] = []
        for key in keys:
            session = self._sessions.get(key)
            if session is None:
                continue
            handles = [
                handle
                for handle in session.clients.values()
                if user_id is None or handle.user_id == user_id
            ]
            if handles:
                targets.append((session, handles))
        if not targets:
            return

        decisions: list[tuple[YDocSession, ClientHandle, ContentRole | None]] = []
        async with open_session() as db:
            checker = PermissionChecker(db)
            for session, handles in targets:
                adapter = get_realtime_adapter(session.key[0])
                for handle in handles:
                    role = await adapter.authorize(
                        db,
                        handle.user_id,
                        session.organization_id,
                        session.key[1],
                        checker=checker,
                    )
                    decisions.append((session, handle, role))
        for session, handle, role in decisions:
            await self._apply_role(session, handle, role)

    async def close_stale_user_sessions(self, user_id: UUID, new_version: int) -> None:
        """Close every handle of ``user_id`` whose ``token_version`` predates ``new_version``."""
        affected = [
            handle
            for session in self._sessions.values()
            for handle in session.clients.values()
            if handle.user_id == user_id
            and (handle.token_version is None or handle.token_version < new_version)
        ]
        for handle in affected:
            await self._close_handle(handle, WS_CLOSE_TOKEN_REVOKED, "token revoked")

    async def close_user_session_by_sid(self, user_id: UUID, session_id: UUID) -> None:
        """Close the handles bound to one revoked session; ``token_version`` did not change."""
        affected = [
            handle
            for session in self._sessions.values()
            for handle in session.clients.values()
            if handle.user_id == user_id and handle.session_id == session_id
        ]
        for handle in affected:
            await self._close_handle(handle, WS_CLOSE_TOKEN_REVOKED, "session revoked")

    async def _resolve_outbound_audience(
        self,
        key: DocKey,
        actors: list[UUID],
    ) -> dict[UUID, tuple[YDocSession, ContentRole | None]]:
        session = self._sessions.get(key)
        if session is None:
            raise RuntimeError("Document detached before disclosure")
        async with open_session() as db:
            roles = await get_realtime_adapter(key[0]).authorize_many(
                db,
                actors,
                session.organization_id,
                key[1],
            )
        return {actor: (session, roles.get(actor)) for actor in actors}

    async def _apply_role(
        self,
        session: YDocSession,
        handle: ClientHandle,
        role: ContentRole | None,
    ) -> None:
        if role is None or not role_can_view(role):
            REALTIME_PERMISSION_REJECTIONS_TOTAL.labels(
                content_type=session.key[0].value, reason="role_revoked"
            ).inc()
            await self._close_handle(handle, WS_CLOSE_FORBIDDEN, "access revoked")
            return
        can_edit = role_can_edit(role)
        if handle.can_edit and not can_edit:
            enqueue_for_handle(
                handle, create_auth_denied_message("edit access removed"), kind="auth"
            )
        changed = handle.can_edit != can_edit
        handle.can_edit = can_edit
        if changed:
            await self._reelect_seeder(session)

    async def _close_handle(self, handle: ClientHandle, code: int, reason: str) -> None:
        if handle.closed:
            return
        if code == WS_CLOSE_FORBIDDEN:
            # Only this document goes; the socket keeps its other documents.
            enqueue_for_handle(handle, create_auth_denied_message(reason, no_view=True), kind="auth")
            handle.ws_session.denied_docs.add(handle.doc_key)
            handle.closed = True
            await self._release(handle.doc_key, handle.conn_id)
            return
        handle.closed = True
        session = self._sessions.get(handle.doc_key)
        if session is not None:
            await self._reelect_seeder(session)
        with contextlib.suppress(BaseException):
            await handle.ws.close(code=code, reason=reason)
