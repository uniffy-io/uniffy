"""Provider registry - discovers and manages LLM provider descriptors."""

from uniffy.core.errors import ValidationError
from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor


class ProviderRegistry:
    """Registry of available LLM provider descriptors.

    Centralises provider discovery so that adding a new provider requires
    only implementing :class:`ProviderDescriptor` and registering it here.
    """

    def __init__(self) -> None:
        self._descriptors: dict[str, ProviderDescriptor] = {}

    def register(self, descriptor: ProviderDescriptor) -> None:
        """Register a provider descriptor.

        Parameters
        ----------
        descriptor : ProviderDescriptor
            The descriptor to register.

        """
        self._descriptors[descriptor.name] = descriptor

    def create_provider(
        self,
        provider: str,
        credential: str,
        credential_type: str = "api_key",
    ) -> LLMProvider:
        """Create an LLMProvider instance for the given provider.

        Parameters
        ----------
        provider : str
            Provider name (e.g. "anthropic").
        credential : str
            Decrypted credential.
        credential_type : str
            Credential type.

        Returns
        -------
        LLMProvider
            Configured provider instance.

        Raises
        ------
        ValidationError
            If the provider is not registered.

        """
        descriptor = self._descriptors.get(provider)
        if not descriptor:
            raise ValidationError("provider", f"Unsupported provider: {provider}")
        return descriptor.create(credential, credential_type)

    def get_models_for_provider(self, provider: str) -> list[ModelInfo]:
        """Return the model catalog for a given provider.

        Parameters
        ----------
        provider : str
            Provider name.

        Returns
        -------
        list[ModelInfo]
            Available models (empty if provider unknown).

        """
        descriptor = self._descriptors.get(provider)
        if not descriptor:
            return []
        return descriptor.get_models()

    def validate_credential(
        self,
        provider: str,
        credential: str,
        credential_type: str,
    ) -> None:
        """Validate credential format for a provider.

        Parameters
        ----------
        provider : str
            Provider name.
        credential : str
            Raw credential string.
        credential_type : str
            Credential type.

        Raises
        ------
        ValidationError
            If the provider is unknown or credential format is invalid.

        """
        descriptor = self._descriptors.get(provider)
        if not descriptor:
            raise ValidationError("provider", f"Unsupported provider: {provider}")
        descriptor.validate_credential(credential, credential_type)

    def list_providers(self) -> list[ProviderDescriptor]:
        """Return all registered provider descriptors.

        Returns
        -------
        list[ProviderDescriptor]
            Registered descriptors.

        """
        return list(self._descriptors.values())


_registry: ProviderRegistry | None = None


def get_provider_registry() -> ProviderRegistry:
    """Return the singleton provider registry, creating it on first call.

    Returns
    -------
    ProviderRegistry
        The global provider registry with all providers registered.

    """
    global _registry
    if _registry is not None:
        return _registry

    _registry = ProviderRegistry()

    from uniffy.domains.agents.providers.anthropic import AnthropicDescriptor
    from uniffy.domains.agents.providers.google import GoogleDescriptor
    from uniffy.domains.agents.providers.openai import OpenAIDescriptor

    _registry.register(AnthropicDescriptor())
    _registry.register(OpenAIDescriptor())
    _registry.register(GoogleDescriptor())

    return _registry
