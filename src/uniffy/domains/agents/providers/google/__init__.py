"""Google Gemini provider subpackage."""

from uniffy.domains.agents.providers.base import LLMProvider, ModelInfo, ProviderDescriptor
from uniffy.domains.agents.providers.google.catalog import FALLBACK_MODELS
from uniffy.domains.agents.providers.google.provider import GoogleProvider
from uniffy.domains.agents.providers.google.validation import validate_google_credential


class GoogleDescriptor(ProviderDescriptor):
    """Provider descriptor for Google Gemini models.

    Bundles the Google provider factory, model catalog, and credential
    validation into a single registration unit.
    """

    @property
    def name(self) -> str:
        """Return the canonical provider name."""
        return "google"

    @property
    def display_name(self) -> str:
        """Return the human-readable provider name."""
        return "Google"

    @property
    def supported_credential_types(self) -> list[str]:
        """Return credential types accepted by Google.

        Returns
        -------
        list[str]
            Supported credential types.

        """
        return ["api_key"]

    def create(self, credential: str, credential_type: str) -> LLMProvider:
        """Create a GoogleProvider instance.

        Parameters
        ----------
        credential : str
            Decrypted API key.
        credential_type : str
            Credential type.

        Returns
        -------
        LLMProvider
            Configured Google provider.

        """
        return GoogleProvider(credential, credential_type=credential_type)

    def get_models(self) -> list[ModelInfo]:
        """Return the static fallback Google model catalog.

        This is the synchronous fallback used by the registry when no
        live provider instance is available.

        Returns
        -------
        list[ModelInfo]
            Static fallback Google Gemini models.

        """
        return list(FALLBACK_MODELS)

    def validate_credential(self, credential: str, credential_type: str) -> None:
        """Validate a Google credential format.

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
        validate_google_credential(credential, credential_type)
