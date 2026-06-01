"""OpenAI provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.catalog import model_infos_for_provider
from uniffy.domains.agents.providers.openai.provider import OpenAIProvider
from uniffy.domains.agents.providers.openai.validation import validate_openai_credential


class OpenAIDescriptor(ProviderDescriptor):
    """Provider descriptor for OpenAI models.

    Bundles the OpenAI provider factory, model catalog, and credential
    validation into a single registration unit.
    """

    @property
    def name(self) -> str:
        """Return the canonical provider name."""
        return "openai"

    @property
    def display_name(self) -> str:
        """Return the human-readable provider name."""
        return "OpenAI"

    @property
    def supported_credential_types(self) -> list[str]:
        """Return credential types accepted by OpenAI.

        Returns
        -------
        list[str]
            Supported credential types.

        """
        return ["api_key"]

    def create(self, credential: str, credential_type: str) -> LLMProvider:
        """Create an OpenAIProvider instance.

        Parameters
        ----------
        credential : str
            Decrypted API key.
        credential_type : str
            Credential type.

        Returns
        -------
        LLMProvider
            Configured OpenAI provider.

        """
        return OpenAIProvider(credential, credential_type=credential_type)

    def get_models(self) -> list[ModelInfo]:
        """Return the static OpenAI catalog (used when no live key is set)."""
        return model_infos_for_provider("openai")

    def validate_credential(self, credential: str, credential_type: str) -> None:
        """Validate an OpenAI credential format.

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
        validate_openai_credential(credential, credential_type)
