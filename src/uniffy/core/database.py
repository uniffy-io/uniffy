"""Application contract for opening an isolated database session."""

from contextlib import AbstractAsyncContextManager
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

SESSION_FACTORY_CTX_KEY = "session_factory"


class SessionFactory(Protocol):
    def __call__(self) -> AbstractAsyncContextManager[AsyncSession]: ...


__all__ = ["SESSION_FACTORY_CTX_KEY", "SessionFactory"]
