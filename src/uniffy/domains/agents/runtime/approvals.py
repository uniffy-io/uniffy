"""In-memory approval store for human-in-the-loop tool confirmation.

When a destructive tool call requires user approval, the streaming runtime
pauses execution, yields a confirmation_required event, and polls this
store until the user responds.

The store is keyed by (session_id, tool_call_id) and holds the approval
decision. Entries are automatically cleaned up after retrieval.
"""

import asyncio
from uuid import UUID


class ApprovalStore:
    """Thread-safe in-memory store for pending tool approvals.

    Each pending approval is an asyncio.Event + result pair. The
    streaming runtime waits on the event while the confirmation
    RPC handler sets the result and signals the event.
    """

    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Event] = {}
        self._results: dict[str, bool] = {}

    def _key(self, session_id: UUID, tool_call_id: str) -> str:
        """Build a unique key for a pending approval."""
        return f"{session_id}:{tool_call_id}"

    def register(self, session_id: UUID, tool_call_id: str) -> None:
        """Register a pending approval request.

        Parameters
        ----------
        session_id : UUID
            Session the tool call belongs to.
        tool_call_id : str
            Tool call identifier.

        """
        key = self._key(session_id, tool_call_id)
        self._pending[key] = asyncio.Event()

    async def wait_for_response(
        self,
        session_id: UUID,
        tool_call_id: str,
        timeout: float = 120.0,
    ) -> bool | None:
        """Wait for the user to approve or reject a tool call.

        Parameters
        ----------
        session_id : UUID
            Session the tool call belongs to.
        tool_call_id : str
            Tool call identifier.
        timeout : float
            Maximum seconds to wait (default 120s).

        Returns
        -------
        bool | None
            True if approved, False if rejected, None if timed out.

        """
        key = self._key(session_id, tool_call_id)
        event = self._pending.get(key)
        if not event:
            return None

        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except TimeoutError:
            self._cleanup(key)
            return None

        result = self._results.get(key)
        self._cleanup(key)
        return result

    def respond(self, session_id: UUID, tool_call_id: str, approved: bool) -> bool:
        """Set the approval response for a pending tool call.

        Parameters
        ----------
        session_id : UUID
            Session the tool call belongs to.
        tool_call_id : str
            Tool call identifier.
        approved : bool
            Whether the user approved the action.

        Returns
        -------
        bool
            True if a pending request was found and responded to.

        """
        key = self._key(session_id, tool_call_id)
        event = self._pending.get(key)
        if not event:
            return False

        self._results[key] = approved
        event.set()
        return True

    def _cleanup(self, key: str) -> None:
        """Remove a pending approval entry."""
        self._pending.pop(key, None)
        self._results.pop(key, None)


# Singleton approval store
_approval_store: ApprovalStore | None = None


def get_approval_store() -> ApprovalStore:
    """Return the global approval store.

    Returns
    -------
    ApprovalStore
        The singleton approval store.

    """
    global _approval_store  # noqa: PLW0603
    if _approval_store is None:
        _approval_store = ApprovalStore()
    return _approval_store
