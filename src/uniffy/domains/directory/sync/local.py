"""The built-in source for accounts created in-app."""

from collections.abc import AsyncIterator
from typing import ClassVar

from uniffy.core.models.people.identity import IdentitySourceKind
from uniffy.domains.directory.sync.base import DirectorySyncProvider
from uniffy.domains.directory.sync.types import (
    DirectoryGroup,
    DirectoryUser,
    SourceCapabilities,
)


class LocalDirectoryProvider(DirectorySyncProvider):
    """Yields nothing: local accounts have no external backend. The row exists
    so every org has a source for links and the driver has a real
    implementation to run against."""

    kind: ClassVar[IdentitySourceKind] = IdentitySourceKind.LOCAL
    capabilities: ClassVar[SourceCapabilities] = SourceCapabilities()

    async def fetch_users(self) -> AsyncIterator[DirectoryUser]:
        return
        yield

    async def fetch_groups(self) -> AsyncIterator[DirectoryGroup]:
        return
        yield

    async def validate(self) -> None:
        return None
