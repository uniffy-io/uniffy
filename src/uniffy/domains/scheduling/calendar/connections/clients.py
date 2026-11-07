"""The provider client for an organization, built from whichever app its credentials resolve to."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from uniffy.core.errors import ValidationError
from uniffy.core.models.calendar.connection import CalendarProvider
from uniffy.domains.scheduling.calendar.connections.credentials import (
    ProviderCredentials,
    resolve_provider_credentials,
)
from uniffy.domains.scheduling.calendar.connections.providers.google import GoogleCalendarClient
from uniffy.domains.scheduling.calendar.connections.providers.microsoft import (
    MicrosoftCalendarClient,
)
from uniffy.domains.scheduling.calendar.mail.context import base_url

CALLBACK_PATH = "/calendar/connect/callback"

ProviderClient = GoogleCalendarClient | MicrosoftCalendarClient


def redirect_uri() -> str:
    """Registered with both provider apps; the web page there finishes the sign-in."""
    return f"{base_url()}{CALLBACK_PATH}"


def client_for(credentials: ProviderCredentials) -> ProviderClient:
    if credentials.provider == CalendarProvider.GOOGLE:
        return GoogleCalendarClient(credentials.client_id, credentials.client_secret)
    return MicrosoftCalendarClient(
        credentials.client_id, credentials.client_secret, credentials.tenant
    )


async def require_credentials(
    session: AsyncSession, organization_id: UUID, provider: CalendarProvider
) -> ProviderCredentials:
    credentials = await resolve_provider_credentials(session, organization_id, provider)
    if credentials is None:
        raise ValidationError(
            "provider", "This calendar service is not set up for your organization."
        )
    return credentials
