"""Anthropic provider subpackage."""

from uniffy.domains.agents.providers.anthropic.catalog import FALLBACK_MODELS
from uniffy.domains.agents.providers.anthropic.provider import AnthropicProvider
from uniffy.domains.agents.providers.anthropic.validation import validate_anthropic_credential
from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor


class AnthropicDescriptor(ProviderDescriptor):
    """Provider descriptor for Anthropic Claude models.

    Bundles the Anthropic provider factory, model catalog, and credential
    validation into a single registration unit.
    """

    @property
    def name(self) -> str:
        """Return the canonical provider name."""
        return "anthropic"

    @property
    def display_name(self) -> str:
        """Return the human-readable provider name."""
        return "Anthropic"

    @property
    def supported_credential_types(self) -> list[str]:
        """Return credential types accepted by Anthropic.

        Returns
        -------
        list[str]
            Supported credential types.

        """
        return ["api_key", "setup_token"]

    def create(self, credential: str, credential_type: str) -> LLMProvider:
        """Create an AnthropicProvider instance.

        Parameters
        ----------
        credential : str
            Decrypted API key or setup token.
        credential_type : str
            Credential type.

        Returns
        -------
        LLMProvider
            Configured Anthropic provider.

        """
        return AnthropicProvider(credential, credential_type=credential_type)

    def get_models(self) -> list[ModelInfo]:
        """Return the static fallback Anthropic model catalog.

        This is the synchronous fallback used by the registry when no
        live provider instance is available.  The full dynamic catalog
        is returned by :meth:`AnthropicProvider.get_available_models`.

        Returns
        -------
        list[ModelInfo]
            Static fallback Anthropic models.

        """
        return list(FALLBACK_MODELS)

    def validate_credential(self, credential: str, credential_type: str) -> None:
        """Validate an Anthropic credential format.

        Parameters
        ----------
        credential : str
            Raw credential string.
        credential_type : str
            Credential type.

        Raises
        ------
        ValidationError
            If the credential format is invalid.

        """
        validate_anthropic_credential(credential, credential_type)
