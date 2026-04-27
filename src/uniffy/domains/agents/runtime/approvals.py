"""Durable approval store for human-in-the-loop tool confirmation.

Each pending approval has two layers:

- An in-process ``asyncio.Event`` that wakes the paused tool loop as soon
  as the user clicks allow / deny. This is the fast path and the only
  mechanism when Valkey is unavailable (tests, local dev).
- A Valkey-backed hash keyed ``approval:<scope_id>:<request_id>`` with
  TTL so the decision survives pod restarts and so audit readers can see
  the outcome after the runtime has torn down the stream.

Scope id is the session id for legacy session invocations and the chat
channel id for chat-triggered invocations. Request id is the tool call
id from the LLM (stable per invocation) which keeps the approval row
addressable by the RespondToAgentConfirmation RPC.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from loguru import logger

from uniffy.core.valkey.cache import cache_delete, cache_get, cache_set
from uniffy.observability.metrics import (
    APPROVAL_STORE_PENDING_SIZE,
    APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL,
)

APPROVAL_TTL_SECONDS = 24 * 60 * 60
_APPROVAL_KEY_PREFIX = "approval"
_SWEEP_GRACE_SECONDS = 60


def _approval_key(scope_id: UUID | str, request_id: UUID | str) -> str:
    return f"{_APPROVAL_KEY_PREFIX}:{scope_id}:{request_id}"


class ApprovalStore:
    """Thread-safe approval store with Valkey durability.

    The in-memory ``_pending`` + ``_results`` dicts power the wait path.
    Valkey holds the authoritative decision for cross-process visibility
    and restart durability. When Valkey is unavailable the store still
    works: it simply loses durability beyond the hosting process.
    """

    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Event] = {}
        self._results: dict[str, bool] = {}
        self._register_time: dict[str, float] = {}

    def _key(self, scope_id: UUID | str, request_id: UUID | str) -> str:
        """Build the local + Valkey composite key."""
        return _approval_key(scope_id, request_id)

    def _sweep_expired(self) -> None:
        """Evict in-process entries older than ``APPROVAL_TTL_SECONDS + grace``.

        Called on every ``register``. Without this any client that
        disconnects mid-flight (or any Valkey outage that prevents the
        ``respond`` write) leaks an `asyncio.Event` and its result slot
        forever - the original implementation only cleaned up on the
        success path. Waiters on swept entries are released with
        ``None`` (timeout-equivalent) by setting the event.
        """
        if not self._register_time:
            APPROVAL_STORE_PENDING_SIZE.set(len(self._pending))
            return

        cutoff = time.monotonic() - (APPROVAL_TTL_SECONDS + _SWEEP_GRACE_SECONDS)
        stale = [k for k, ts in self._register_time.items() if ts < cutoff]
        for key in stale:
            event = self._pending.pop(key, None)
            if event is not None:
                event.set()
            self._results.pop(key, None)
            self._register_time.pop(key, None)
        if stale:
            logger.info(f"Approval store swept {len(stale)} expired entries")
        APPROVAL_STORE_PENDING_SIZE.set(len(self._pending))

    async def register(
        self,
        scope_id: UUID | str,
        request_id: UUID | str,
        *,
        actor_user_id: UUID | None = None,
        agent_id: UUID | None = None,
        tool_name: str | None = None,
        tool_args: dict | None = None,
        channel_id: UUID | None = None,
        message_id: UUID | None = None,
    ) -> None:
        """Register a pending approval request.

        Records a `pending` row in Valkey (non-fatal on failure) and
        creates the local wake-event. Safe to call twice for the same
        key; later calls overwrite the Valkey row.
        """
        self._sweep_expired()

        key = self._key(scope_id, request_id)
        self._pending[key] = asyncio.Event()
        self._register_time[key] = time.monotonic()
        APPROVAL_STORE_PENDING_SIZE.set(len(self._pending))

        payload: dict[str, Any] = {
            "status": "pending",
            "requested_at": datetime.now(UTC).isoformat(),
        }
        if actor_user_id is not None:
            payload["actor_user_id"] = str(actor_user_id)
        if agent_id is not None:
            payload["agent_id"] = str(agent_id)
        if tool_name is not None:
            payload["tool_name"] = tool_name
        if tool_args is not None:
            payload["args_json"] = tool_args
        if channel_id is not None:
            payload["channel_id"] = str(channel_id)
        if message_id is not None:
            payload["message_id"] = str(message_id)

        try:
            await cache_set(key, payload, ttl=APPROVAL_TTL_SECONDS)
        except Exception:
            APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL.labels(op="register").inc()
            logger.warning(f"Approval register: Valkey write failed for {key}")

    async def wait_for_response(
        self,
        scope_id: UUID | str,
        request_id: UUID | str,
        timeout: float = 120.0,
    ) -> bool | None:
        """Wait for the user to approve or reject a tool call.

        Returns True on approve, False on deny, None on timeout. The
        Valkey row is consulted on wake so a decision recorded by a
        separate process / RPC call still resolves correctly; if Valkey
        says ``pending`` but the local event fired, we fall back to the
        in-memory result.
        """
        key = self._key(scope_id, request_id)
        event = self._pending.get(key)
        if not event:
            return None

        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except TimeoutError:
            await self._cleanup(key)
            return None

        result = self._results.get(key)

        try:
            valkey_entry = await cache_get(key)
            if isinstance(valkey_entry, dict):
                status = valkey_entry.get("status")
                if status == "approved":
                    result = True
                elif status == "denied":
                    result = False
        except Exception:
            APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL.labels(op="wait").inc()
            logger.warning(f"Approval wait: Valkey read failed for {key}")

        await self._cleanup(key)
        return result

    async def respond(
        self,
        scope_id: UUID | str,
        request_id: UUID | str,
        approved: bool,
        *,
        decided_by: UUID | None = None,
        rationale: str | None = None,
    ) -> bool:
        """Set the approval response.

        Updates Valkey to ``approved`` / ``denied`` and wakes the local
        event if one exists. Returns True when either path is live; the
        Valkey record is the authority for cross-process readers.
        """
        key = self._key(scope_id, request_id)
        resolved_locally = False

        event = self._pending.get(key)
        if event is not None:
            self._results[key] = approved
            event.set()
            resolved_locally = True

        try:
            existing = await cache_get(key)
            row: dict[str, Any] = {}
            if isinstance(existing, dict):
                row.update(existing)
            row["status"] = "approved" if approved else "denied"
            row["decided_at"] = datetime.now(UTC).isoformat()
            if decided_by is not None:
                row["decided_by"] = str(decided_by)
            if rationale is not None:
                row["rationale"] = rationale
            await cache_set(key, row, ttl=APPROVAL_TTL_SECONDS)
            valkey_ok = True
        except Exception:
            APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL.labels(op="respond").inc()
            logger.warning(f"Approval respond: Valkey write failed for {key}")
            valkey_ok = False

        return resolved_locally or valkey_ok

    async def get_state(
        self,
        scope_id: UUID | str,
        request_id: UUID | str,
    ) -> dict[str, Any] | None:
        """Read the current state of an approval from Valkey.

        Returns the full hash dict or None when absent / unreadable.
        """
        key = self._key(scope_id, request_id)
        try:
            entry = await cache_get(key)
            if isinstance(entry, dict):
                return entry
        except Exception:
            APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL.labels(op="get_state").inc()
            logger.warning(f"Approval get_state: Valkey read failed for {key}")
        return None

    async def list_pending_by_scope(
        self,
        scope_id: UUID | str,
    ) -> list[dict[str, Any]]:
        """Enumerate pending approvals for a scope (channel id / session id).

        Uses Valkey SCAN to find every ``approval:<scope_id>:*`` key, fetches
        each row, and returns the subset with ``status == 'pending'`` plus a
        ``request_id`` field extracted from the key. Absent/unreadable rows
        are silently skipped; Valkey failure returns an empty list.
        """
        from uniffy.core.valkey.ops import _get_ops_client

        client = _get_ops_client()
        if client is None:
            return []

        prefix = f"{_APPROVAL_KEY_PREFIX}:{scope_id}:"
        pattern = f"{prefix}*"
        pending: list[dict[str, Any]] = []
        try:
            async for raw_key in client.scan_iter(match=pattern, count=100):
                key = raw_key.decode() if isinstance(raw_key, bytes) else raw_key
                entry = await cache_get(key)
                if not isinstance(entry, dict):
                    continue
                if entry.get("status") != "pending":
                    continue
                request_id = key[len(prefix) :] if key.startswith(prefix) else ""
                row = dict(entry)
                row["request_id"] = request_id
                pending.append(row)
        except Exception:
            APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL.labels(op="list_pending").inc()
            logger.warning(f"Approval list_pending_by_scope: Valkey scan failed for {scope_id}")
            return []
        return pending

    async def _cleanup(self, key: str) -> None:
        """Remove the local wake-event and (non-fatal) the Valkey row."""
        self._pending.pop(key, None)
        self._results.pop(key, None)
        self._register_time.pop(key, None)
        APPROVAL_STORE_PENDING_SIZE.set(len(self._pending))
        try:
            await cache_delete(key)
        except Exception:
            APPROVAL_STORE_VALKEY_UNREACHABLE_TOTAL.labels(op="cleanup").inc()


_approval_store: ApprovalStore | None = None


def get_approval_store() -> ApprovalStore:
    """Return the global approval store."""
    global _approval_store  # noqa: PLW0603
    if _approval_store is None:
        _approval_store = ApprovalStore()
    return _approval_store
