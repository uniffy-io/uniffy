"""Abstract LLM provider and shared data classes."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

if TYPE_CHECKING:
    from uniffy.core.models.agents.message import AgentMessage
    from uniffy.core.models.agents.skill_draft import AgentSkillDraft


@dataclass(frozen=True)
class ModelInfo:
    """Static model metadata sourced from the catalog.

    Pricing is per one million tokens in USD. ``reasoning_levels`` are the
    ``reasoning_effort`` values the model accepts (empty when it has no
    discrete levels); ``supports_thinking`` is whether it reasons at all.
    """

    id: str
    display_name: str
    provider: str
    context_window: int
    supports_tools: bool = False
    supports_vision: bool = False
    supports_thinking: bool = False
    supports_prompt_cache: bool = False
    supports_image_generation: bool = False
    default_max_tokens: int | None = None
    aliases: tuple[str, ...] = ()
    deprecated: bool = False
    # True when this id resolves to a curated catalog entry (vs a live-API
    # model we have no catalog row for). Drives the chat-model pickers.
    catalog_known: bool = False
    reasoning_levels: tuple[str, ...] = ()
    default_reasoning_effort: str | None = None
    input_per_1m: Decimal | None = None
    output_per_1m: Decimal | None = None
    cache_read_per_1m: Decimal | None = None
    cache_write_per_1m: Decimal | None = None


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
    `thinking_blocks` are provider-native reasoning blocks (Anthropic
    shape, signature included); the tool loop MUST re-feed them on the
    assistant turn when continuing with tool results, or the API
    rejects the request. They are never persisted across turns.
    """

    content: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    tool_calls: list[ToolCall] = field(default_factory=list)
    thinking_blocks: list[dict] = field(default_factory=list)
    stop_reason: str = "end_turn"

    @property
    def total_prompt_tokens(self) -> int:
        """Real prompt size (cached + uncached input)."""
        return (
            int(self.input_tokens or 0)
            + int(self.cache_creation_input_tokens or 0)
            + int(self.cache_read_input_tokens or 0)
        )


class EventType(StrEnum):
    """Every event in the unified agent streaming protocol.

    Providers emit the block events plus ``MODEL_CALL_START`` /
    ``MODEL_CALL_END`` / ``ERROR``; the runtime emits the rest.
    ``MODEL_CALL_END`` is the per-model-call terminal (it carries the
    ``CompletionResult``); ``DONE`` is the per-run terminal.
    """

    REPLY_START = "reply_start"
    MODEL_CALL_START = "model_call_start"
    MODEL_CALL_END = "model_call_end"
    TEXT_BLOCK_START = "text_block_start"
    TEXT_BLOCK_DELTA = "text_block_delta"
    TEXT_BLOCK_END = "text_block_end"
    THINKING_BLOCK_START = "thinking_block_start"
    THINKING_BLOCK_DELTA = "thinking_block_delta"
    THINKING_BLOCK_END = "thinking_block_end"
    TOOL_CALL_START = "tool_call_start"
    TOOL_CALL_DELTA = "tool_call_delta"
    TOOL_CALL_END = "tool_call_end"
    TOOL_RESULT_START = "tool_result_start"
    TOOL_RESULT_DELTA = "tool_result_delta"
    TOOL_RESULT_END = "tool_result_end"
    CONFIRMATION_REQUIRED = "confirmation_required"
    CONFIRMATION_RESPONSE = "confirmation_response"
    FAILOVER = "failover"
    SKILL_DRAFT = "skill_draft"
    EXCEED_MAX_ITERS = "exceed_max_iters"
    MESSAGE_STORED = "message_stored"
    DONE = "done"
    ERROR = "error"


@dataclass(slots=True)
class StreamEvent:
    """One event in the unified stream, discriminated by ``type``.

    Fields are sparse: each ``EventType`` populates only its own subset,
    mirroring the proto oneof. Thinking deltas travel ONLY as
    ``thinking_block_*`` events and must never be folded into text
    content anywhere downstream. The fields from ``message_id`` on are
    runtime-enriched and always unset at the provider layer.
    """

    type: EventType
    block_id: str = ""
    delta: str = ""
    model: str = ""
    signature: str = ""
    elapsed_ms: int = 0
    tool_call_id: str = ""
    tool_name: str = ""
    tool_args: dict | None = None
    success: bool = True
    tool_result: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    thinking_tokens: int = 0
    result: CompletionResult | None = None
    error: str = ""
    description: str = ""
    from_provider_key_id: str = ""
    to_provider_key_id: str = ""
    to_model: str = ""
    reason: str = ""
    attempt: int = 0
    approved: bool = False
    message_id: UUID | None = None
    sequence: int = 0
    request_id: UUID | None = None
    message: AgentMessage | None = None
    assistant_message: AgentMessage | None = None
    draft: AgentSkillDraft | None = None


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

    @abstractmethod
    def create(self, credential: str) -> LLMProvider:
        """Create an `LLMProvider` instance from a decrypted credential."""

    @abstractmethod
    def get_models(self) -> list[ModelInfo]:
        """Return the static model catalog."""


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
        params: dict | None = None,
    ) -> CompletionResult | AsyncIterator[StreamEvent]:
        """Send a chat completion request.

        `cache_key` enables cache-affinity routing on providers that
        support it (OpenAI maps it to `prompt_cache_key`); Anthropic and
        Google cache transparently and ignore the value.

        `params` carries validated normalized knob values (temperature,
        top_p, max_tokens, reasoning_effort, provider_options) that each
        provider maps onto its native request shape. `None` = provider
        defaults.
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
    async def get_available_models(self) -> list[ModelInfo]:
        """List the models this provider serves, from the local catalog."""
