"""Abstract LLM provider and shared data classes."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelInfo:
    """Static model metadata from the catalog.

    Attributes
    ----------
    id : str
        Provider model identifier (e.g. "claude-opus-4-6").
    display_name : str
        Human-readable name.
    provider : str
        Provider name (e.g. "anthropic").
    context_window : int
        Maximum context window size in tokens.
    supports_tools : bool
        Whether the model supports tool use.
    supports_vision : bool
        Whether the model supports image inputs.
    supports_thinking : bool
        Whether the model supports extended thinking.

    """

    id: str
    display_name: str
    provider: str
    context_window: int
    supports_tools: bool = False
    supports_vision: bool = False
    supports_thinking: bool = False


@dataclass
class ToolCall:
    """A tool call requested by the model.

    Attributes
    ----------
    id : str
        Tool call identifier.
    name : str
        Tool function name.
    input : dict
        Tool input arguments.
    metadata : dict
        Provider-specific metadata (e.g. Google thought_signature).

    """

    id: str
    name: str
    input: dict
    metadata: dict = field(default_factory=dict)


@dataclass
class CompletionResult:
    """Result from a non-streaming chat completion.

    Attributes
    ----------
    content : str
        The text content of the response.
    model : str
        Model identifier that generated the response.
    input_tokens : int
        Number of input tokens consumed.
    output_tokens : int
        Number of output tokens generated.
    tool_calls : list[ToolCall]
        Tool calls requested by the model.
    stop_reason : str
        Reason the model stopped generating.

    """

    content: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = "end_turn"


# Stream event hierarchy


@dataclass
class StreamEvent:
    """Base class for streaming events."""


@dataclass
class TokenEvent(StreamEvent):
    """A text token emitted during streaming.

    Attributes
    ----------
    text : str
        The token text.

    """

    text: str = ""


@dataclass
class ToolCallEvent(StreamEvent):
    """A tool call emitted during streaming.

    Attributes
    ----------
    tool_call : ToolCall
        The tool call data.

    """

    tool_call: ToolCall = field(default_factory=lambda: ToolCall(id="", name="", input={}))


@dataclass
class DoneEvent(StreamEvent):
    """Signals completion of streaming.

    Attributes
    ----------
    result : CompletionResult
        Final aggregated result with token counts.

    """

    result: CompletionResult = field(default_factory=lambda: CompletionResult(content="", model=""))


@dataclass
class ErrorEvent(StreamEvent):
    """An error encountered during streaming.

    Attributes
    ----------
    error : str
        Error description.

    """

    error: str = ""


class ProviderDescriptor(ABC):
    """Registration interface for an LLM provider.

    Each provider subpackage implements this to bundle its factory,
    model catalog, and credential validation into a single descriptor
    that is registered with the :class:`ProviderRegistry`.

    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the canonical provider name (e.g. "anthropic")."""

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Return the human-readable provider name (e.g. "Anthropic")."""

    @property
    @abstractmethod
    def supported_credential_types(self) -> list[str]:
        """Return credential types accepted by this provider.

        Returns
        -------
        list[str]
            e.g. ["api_key", "setup_token"].

        """

    @abstractmethod
    def create(self, credential: str, credential_type: str) -> LLMProvider:
        """Create an LLMProvider instance for this provider.

        Parameters
        ----------
        credential : str
            Decrypted credential (API key or token).
        credential_type : str
            Credential type (e.g. "api_key").

        Returns
        -------
        LLMProvider
            Configured provider instance.

        """

    @abstractmethod
    def get_models(self) -> list[ModelInfo]:
        """Return the static model catalog for this provider.

        Returns
        -------
        list[ModelInfo]
            Available models.

        """

    @abstractmethod
    def validate_credential(self, credential: str, credential_type: str) -> None:
        """Validate credential format (not API validity).

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


class LLMProvider(ABC):
    """Abstract base class for LLM provider integrations.

    Subclasses implement provider-specific API calls (Anthropic, OpenAI, etc.).
    """

    @abstractmethod
    async def validate(self) -> tuple[bool, str | None]:
        """Validate the credential against the provider API.

        Returns
        -------
        tuple[bool, str | None]
            (is_valid, error_message). error_message is None when valid.

        """

    @abstractmethod
    async def chat_completion(
        self,
        messages: list[dict],
        model: str,
        *,
        system: str | None = None,
        tools: list[dict] | None = None,
        stream: bool = False,
    ) -> CompletionResult | AsyncIterator[StreamEvent]:
        """Send a chat completion request.

        Parameters
        ----------
        messages : list[dict]
            Conversation messages in provider-native format.
        model : str
            Model identifier.
        system : str | None
            System prompt (top-level for Anthropic API).
        tools : list[dict] | None
            Tool definitions for tool use.
        stream : bool
            Whether to return a streaming iterator.

        Returns
        -------
        CompletionResult | AsyncIterator[StreamEvent]
            Non-streaming result or streaming event iterator.

        """

    async def generate_image(
        self,
        prompt: str,
        *,
        model: str,
        size: str = "1024x1024",
        quality: str = "auto",
    ) -> tuple[bytes, str]:
        """Generate an image from a text prompt.

        Parameters
        ----------
        prompt : str
            Text description of the desired image.
        model : str
            Image generation model identifier.
        size : str
            Image dimensions (e.g. "1024x1024").
        quality : str
            Image quality setting.

        Returns
        -------
        tuple[bytes, str]
            (image_bytes, mime_type).

        Raises
        ------
        NotImplementedError
            If the provider does not support image generation.

        """
        raise NotImplementedError("This provider does not support image generation")

    @abstractmethod
    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """Return the list of models available from this provider.

        Implementations may fetch the list from the provider API and
        enrich it with static capability metadata.

        Parameters
        ----------
        force_refresh : bool
            When True, bypass any cached model list and fetch fresh
            from the provider API.

        Returns
        -------
        list[ModelInfo]
            Available models.

        """
