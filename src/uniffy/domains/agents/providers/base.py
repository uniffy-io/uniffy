"""Abstract LLM provider and shared data classes."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelInfo:
    """Static model metadata from the catalog."""

    id: str
    display_name: str
    provider: str
    context_window: int
    supports_tools: bool = False
    supports_vision: bool = False
    supports_thinking: bool = False


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict
    metadata: dict = field(default_factory=dict)


@dataclass
class CompletionResult:
    """Result from a non-streaming chat completion.

    `input_tokens` is the uncached portion; the full prompt size is
    `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
    """

    content: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = "end_turn"

    @property
    def total_prompt_tokens(self) -> int:
        """Real prompt size (cached + uncached input)."""
        return (
            int(self.input_tokens or 0)
            + int(self.cache_creation_input_tokens or 0)
            + int(self.cache_read_input_tokens or 0)
        )


@dataclass
class StreamEvent:
    """Base class for streaming events."""


@dataclass
class TokenEvent(StreamEvent):
    text: str = ""


@dataclass
class ToolCallEvent(StreamEvent):
    tool_call: ToolCall = field(default_factory=lambda: ToolCall(id="", name="", input={}))


@dataclass
class DoneEvent(StreamEvent):
    result: CompletionResult = field(default_factory=lambda: CompletionResult(content="", model=""))


@dataclass
class ErrorEvent(StreamEvent):
    error: str = ""


class ProviderDescriptor(ABC):
    """Registration interface for an LLM provider."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Canonical provider name (e.g. "anthropic")."""

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable provider name."""

    @property
    @abstractmethod
    def supported_credential_types(self) -> list[str]:
        """Credential types accepted by this provider."""

    @abstractmethod
    def create(self, credential: str, credential_type: str) -> LLMProvider:
        """Create an `LLMProvider` instance from a decrypted credential."""

    @abstractmethod
    def get_models(self) -> list[ModelInfo]:
        """Return the static model catalog."""

    @abstractmethod
    def validate_credential(self, credential: str, credential_type: str) -> None:
        """Validate credential format (not API validity)."""


class LLMProvider(ABC):
    """Abstract base class for LLM provider integrations."""

    @abstractmethod
    async def validate(self) -> tuple[bool, str | None]:
        """Validate the credential against the provider API."""

    @abstractmethod
    async def chat_completion(
        self,
        messages: list[dict],
        model: str,
        *,
        system: str | None = None,
        tools: list[dict] | None = None,
        stream: bool = False,
        cache_key: str | None = None,
    ) -> CompletionResult | AsyncIterator[StreamEvent]:
        """Send a chat completion request.

        `cache_key` enables cache-affinity routing on providers that
        support it (OpenAI maps it to `prompt_cache_key`); Anthropic and
        Google cache transparently and ignore the value.
        """

    async def generate_image(
        self,
        prompt: str,
        *,
        model: str,
        size: str = "1024x1024",
        quality: str = "auto",
    ) -> tuple[bytes, str]:
        """Generate an image from a text prompt; returns `(bytes, mime_type)`."""
        raise NotImplementedError("This provider does not support image generation")

    @abstractmethod
    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """List models; `force_refresh=True` bypasses any cached list."""
