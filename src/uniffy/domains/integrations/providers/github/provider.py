"""GitHub integration provider."""

from typing import ClassVar

from uniffy.core.errors import RateLimitExceededError
from uniffy.domains.agents.tools.definitions import ToolDefinition
from uniffy.domains.integrations.base import (
    IntegrationDescriptor,
    IntegrationError,
    IntegrationProbeResult,
    IntegrationProvider,
)
from uniffy.domains.integrations.http import IntegrationHttpClient
from uniffy.domains.integrations.providers.github.client import (
    GitHubClient,
    build_github_http_client,
)


class GitHubIntegration(IntegrationProvider):
    descriptor: ClassVar[IntegrationDescriptor] = IntegrationDescriptor(
        id="github",
        label="GitHub",
        default_base_url="https://api.github.com",
        credential_placeholder="ghp_... / github_pat_...",
        credential_docs_url=(
            "https://docs.github.com/en/authentication/"
            "keeping-your-account-and-data-secure/managing-your-personal-access-tokens"
        ),
        supports_base_url_override=True,
    )

    def build_http_client(self, credential: str, base_url: str | None) -> IntegrationHttpClient:
        return build_github_http_client(credential, base_url)

    async def validate(self, credential: str, base_url: str | None) -> IntegrationProbeResult:
        """Auth, API, and rate-limit failures become an invalid probe; anything else propagates."""
        client = GitHubClient(self.build_http_client(credential, base_url))
        try:
            payload = await client.get_user()
        except (IntegrationError, RateLimitExceededError) as exc:
            return IntegrationProbeResult(is_valid=False, error=str(exc))
        return IntegrationProbeResult(is_valid=True, account_login=payload.get("login"))

    def tools(self) -> list[ToolDefinition]:
        from uniffy.domains.integrations.providers.github.tools import GITHUB_TOOLS

        return GITHUB_TOOLS
