"""The agent whose tool call is running, so writes can credit it next to the person it acts for."""

from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import UUID

_acting_agent: ContextVar[UUID | None] = ContextVar("acting_agent", default=None)


def current_acting_agent() -> UUID | None:
    return _acting_agent.get()


@contextmanager
def acting_agent(agent_id: UUID | None) -> Generator[None]:
    token = _acting_agent.set(agent_id)
    try:
        yield
    finally:
        _acting_agent.reset(token)
