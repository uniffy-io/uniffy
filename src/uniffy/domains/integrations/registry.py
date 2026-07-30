"""Integration registry: the shipped provider set."""

from uniffy.core.errors import ValidationError
from uniffy.domains.agents.tools.definitions import ToolDefinition
from uniffy.domains.integrations.base import IntegrationProvider


class IntegrationRegistry:
    """Name-keyed set of shipped integration providers."""

    def __init__(self) -> None:
        self._providers: dict[str, IntegrationProvider] = {}

    def register(self, provider: IntegrationProvider) -> None:
        self._providers[provider.descriptor.id] = provider

    def get(self, provider_id: str) -> IntegrationProvider | None:
        return self._providers.get(provider_id)

    def require_known(self, provider_id: str) -> IntegrationProvider:
        provider = self._providers.get(provider_id)
        if provider is None:
            raise ValidationError("provider", f"Unsupported integration: {provider_id}")
        return provider

    def list_providers(self) -> list[IntegrationProvider]:
        return list(self._providers.values())

    def all_tools(self) -> list[ToolDefinition]:
        tools: list[ToolDefinition] = []
        for provider in self._providers.values():
            tools.extend(provider.tools())
        return tools


_registry: IntegrationRegistry | None = None


def get_integration_registry() -> IntegrationRegistry:
    """Return the singleton registry, creating it on first call."""
    global _registry
    if _registry is not None:
        return _registry

    _registry = IntegrationRegistry()

    from uniffy.domains.integrations.providers.github import GitHubIntegration

    _registry.register(GitHubIntegration())

    return _registry
