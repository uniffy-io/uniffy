"""Google Gemini LLM provider implementation using the google-genai SDK."""

import uuid
from collections.abc import AsyncIterator
from typing import Any

from google import genai
from google.genai import types
from loguru import logger

from uniffy.domains.agents.providers.base import (
    VISIBLE_REFUSAL_MESSAGE,
    CompletionResult,
    EventType,
    LLMProvider,
    ModelInfo,
    StreamEvent,
    ToolCall,
)
from uniffy.domains.agents.providers.catalog import (
    model_info_for,
    model_infos_for_provider,
)
from uniffy.domains.agents.providers.google.converters import (
    convert_messages_to_google,
    convert_tools_to_google,
)

logger = logger.bind(component="agents.providers.google.provider")

DEFAULT_ASPECT_RATIO = "1:1"

# The API rejects a lowercase tier silently: the request succeeds and comes
# back at the default size, so the mapping must preserve the uppercase K.
_IMAGE_SIZES = {"512px": "512px", "1K": "1K", "2K": "2K", "4K": "4K"}


def to_image_size(resolution: str | None) -> str:
    """Normalised resolution tier -> the ``imageSize`` spelling Google accepts."""
    return _IMAGE_SIZES.get(resolution or "", "1K")


class GoogleProvider(LLMProvider):
    """Google Gemini provider using the google-genai Python SDK."""

    def __init__(self, credential: str) -> None:
        self._client = genai.Client(api_key=credential)

    @property
    def name(self) -> str:
        """Catalog provider key, used for pricing lookups."""
        return "google"

    async def validate(self) -> tuple[bool, str | None]:
        """Validate the credential against the Google AI API.

        Uses the models.list endpoint to verify the API key is valid.

        Returns
        -------
        tuple[bool, str | None]
            (True, None) if valid, (False, error_message) otherwise.

        """
        try:
            _pager = await self._client.aio.models.list(
                config={"page_size": 1},
            )
            return True, None
        except Exception as e:
            error_str = str(e).lower()
            if "api key" in error_str or "unauthorized" in error_str or "403" in error_str:
                return False, f"Authentication failed: {e}"
            if "429" in error_str or "rate" in error_str:
                logger.warning(f"Rate limited during validation: {e}")
                return True, None
            return False, f"Validation error: {e}"

    async def generate_image(
        self,
        prompt: str,
        *,
        model: str,
        params: dict | None = None,
    ) -> tuple[bytes, str]:
        """Generate an image using a Google model; returns (bytes, mime_type).

        Gemini models produce images through ``generate_content`` with
        ``response_modalities=["IMAGE"]``; Imagen models use the dedicated
        ``generate_images`` endpoint.
        """
        params = params or {}
        if model.startswith("imagen"):
            return await self._generate_image_imagen(prompt, model=model, params=params)
        return await self._generate_image_gemini(prompt, model=model, params=params)

    async def _generate_image_gemini(
        self,
        prompt: str,
        *,
        model: str,
        params: dict,
    ) -> tuple[bytes, str]:
        """Generate an image via Gemini's native image output."""
        config = types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(
                aspect_ratio=params.get("aspect_ratio", DEFAULT_ASPECT_RATIO),
                image_size=to_image_size(params.get("resolution")),
            ),
        )

        response = await self._client.aio.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )

        if not response.candidates or not response.candidates[0].content:
            raise RuntimeError("Google Gemini returned no image content")

        for part in response.candidates[0].content.parts or []:
            if part.inline_data and part.inline_data.data:
                mime_type = part.inline_data.mime_type or "image/png"
                return bytes(part.inline_data.data), mime_type

        raise RuntimeError("Google Gemini response contained no image data")

    async def _generate_image_imagen(
        self,
        prompt: str,
        *,
        model: str,
        params: dict,
    ) -> tuple[bytes, str]:
        """Generate an image via the dedicated Imagen ``generate_images`` endpoint."""
        config = types.GenerateImagesConfig(
            numberOfImages=1,
            aspectRatio=params.get("aspect_ratio", DEFAULT_ASPECT_RATIO),
            imageSize=to_image_size(params.get("resolution")),
            personGeneration=params.get("person_generation", "allow_adult"),
            outputMimeType="image/png",
        )

        response = await self._client.aio.models.generate_images(
            model=model,
            prompt=prompt,
            config=config,
        )

        if not response.generated_images:
            raise RuntimeError("Google Imagen returned no images")

        image = response.generated_images[0].image
        if not image or not image.image_bytes:
            raise RuntimeError("Google Imagen returned an empty image")

        mime_type = image.mime_type or "image/png"
        return bytes(image.image_bytes), mime_type

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
        safety_identifier: str | None = None,
    ) -> CompletionResult | AsyncIterator[StreamEvent]:
        """Send a chat completion request to the Google Gemini API.

        Converts messages and tools from Anthropic format to Google format,
        sends the request, and converts the response back.

        Caching: Gemini 2.5+ implicit caching activates automatically
        on stable prefixes >= 1024 tokens (Flash) / 2048 tokens (Pro).
        We don't pass a cache key -- Gemini does not expose a routing
        knob the way OpenAI's ``prompt_cache_key`` does. Older models
        (``gemini-2.0-*`` and below) have no implicit caching at all
        and ``cached_content_token_count`` always reports 0. Explicit
        caching via ``CachedContent`` is unusable for our agent
        runtime because the API rejects it when ``system_instruction``,
        ``tools``, or ``tool_config`` are set on the request.

        Known bug: implicit caching has been reported to silently fail
        on Gemini 3 Flash Preview when ``tools`` are defined --
        ``cached_content_token_count`` stays 0 even on identical
        prefixes well above the token threshold. Track at
        https://github.com/vercel/ai/issues/11513. No client-side
        workaround beyond switching models.

        Parameters
        ----------
        messages : list[dict]
            Messages in Anthropic format.
        model : str
            Model identifier (e.g. "gemini-2.5-flash").
        system : str | None
            System prompt (passed as system_instruction).
        tools : list[dict] | None
            Tool definitions in Anthropic format.
        stream : bool
            Whether to stream the response.
        cache_key : str | None
            Accepted for interface symmetry; ignored. Google's
            implicit cache routes by prefix hash internally.

        Returns
        -------
        CompletionResult | AsyncIterator[StreamEvent]
            Result or streaming iterator.

        """
        del cache_key, safety_identifier
        google_contents = convert_messages_to_google(messages)
        config = self._build_config(
            model=model,
            system=system,
            tools=tools,
            params=params,
        )

        if stream:
            return self._stream_completion(model, google_contents, config)

        return await self._sync_completion(model, google_contents, config)

    async def get_available_models(self) -> list[ModelInfo]:
        """Return Google models from the catalog (the source of truth)."""
        return model_infos_for_provider("google")

    def _build_config(
        self,
        *,
        model: str,
        system: str | None,
        tools: list[dict] | None,
        params: dict | None = None,
    ) -> types.GenerateContentConfig:
        """Build the GenerateContentConfig for the API call."""
        params = params or {}
        config_kwargs: dict[str, Any] = {}

        if system:
            config_kwargs["system_instruction"] = system

        if tools:
            config_kwargs["tools"] = convert_tools_to_google(tools)
            config_kwargs["automatic_function_calling"] = types.AutomaticFunctionCallingConfig(
                disable=True,
            )

        if params.get("temperature") is not None:
            config_kwargs["temperature"] = params["temperature"]
        if params.get("top_p") is not None:
            config_kwargs["top_p"] = params["top_p"]
        if params.get("max_tokens"):
            config_kwargs["max_output_tokens"] = params["max_tokens"]
        top_k = (params.get("provider_options") or {}).get("top_k")
        if top_k is not None:
            config_kwargs["top_k"] = top_k

        thinking = self._thinking_config(model, params.get("reasoning_effort", "off"))
        if thinking is not None:
            config_kwargs["thinking_config"] = thinking

        return types.GenerateContentConfig(**config_kwargs)

    @staticmethod
    def _thinking_config(model: str, effort: str) -> types.ThinkingConfig | None:
        """Thinking config for the model's API generation, or None.

        Models with catalog ``reasoning_levels`` (Gemini 3+) take
        ``thinking_level``; budget-style reasoners (Gemini 2.5) take a
        dynamic ``thinking_budget`` on "on". ``include_thoughts`` opts
        into streamed thought summaries (the ``thought``-flagged parts
        the stream parser turns into thinking events). "off" omits the
        config entirely - 2.5 Pro cannot disable thinking, so a hard
        budget of 0 would 400 there.
        """
        if effort == "off":
            return None
        info = model_info_for("google", model)
        if info is None or not info.supports_thinking:
            return None
        if info.reasoning_levels:
            return types.ThinkingConfig(thinking_level=effort, include_thoughts=True)
        return types.ThinkingConfig(thinking_budget=-1, include_thoughts=True)

    async def _sync_completion(
        self,
        model: str,
        contents: list[types.Content],
        config: types.GenerateContentConfig,
    ) -> CompletionResult:
        """Execute a non-streaming completion.

        Parameters
        ----------
        model : str
            Model identifier.
        contents : list[types.Content]
            Conversation contents in Google format.
        config : types.GenerateContentConfig
            Generation config.

        Returns
        -------
        CompletionResult
            The completion result.

        """
        response = await self._client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

        content = ""
        tool_calls: list[ToolCall] = []

        if response.candidates:
            candidate = response.candidates[0]
            if candidate.content and candidate.content.parts:
                for part in candidate.content.parts:
                    if part.text:
                        content += part.text
                    elif part.function_call:
                        tc_id = f"toolu_{uuid.uuid4().hex[:24]}"
                        fc_args = part.function_call.args
                        tc_metadata: dict = {}
                        if part.thought_signature:
                            tc_metadata["thought_signature"] = part.thought_signature
                        tool_calls.append(
                            ToolCall(
                                id=tc_id,
                                name=part.function_call.name or "",
                                input=dict(fc_args) if fc_args else {},
                                metadata=tc_metadata,
                            )
                        )

        blocked = bool(_google_block_reason(response))
        if not content and not tool_calls and blocked:
            content = VISIBLE_REFUSAL_MESSAGE
        stop_reason = _google_stop_reason(response, tool_calls, blocked=blocked)

        prompt_tokens, cached_tokens, output_tokens = _split_google_usage(response.usage_metadata)

        return CompletionResult(
            content=content,
            model=model,
            input_tokens=prompt_tokens - cached_tokens,
            output_tokens=output_tokens,
            cache_read_input_tokens=cached_tokens,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
        )

    async def _stream_completion(
        self,
        model: str,
        contents: list[types.Content],
        config: types.GenerateContentConfig,
    ) -> AsyncIterator[StreamEvent]:
        """Stream block-framed events; MODEL_CALL_END carries the CompletionResult.

        Parts flagged ``thought`` are Gemini thinking summaries: they map
        to thinking blocks and are filtered OUT of the answer text.
        Function calls arrive whole, so each yields an immediate
        TOOL_CALL_START / TOOL_CALL_END pair.
        """
        try:
            accumulated_content = ""
            tool_calls: list[ToolCall] = []
            prompt_tokens = 0
            cached_tokens = 0
            output_tokens = 0
            thinking_block_id = ""
            text_block_id = ""
            blocked = False

            stream = await self._client.aio.models.generate_content_stream(
                model=model,
                contents=contents,
                config=config,
            )
            yield StreamEvent(type=EventType.MODEL_CALL_START, model=model)

            async for chunk in stream:
                blocked = blocked or bool(_google_block_reason(chunk))
                if chunk.usage_metadata:
                    prompt_tokens, cached_tokens, output_tokens = _split_google_usage(
                        chunk.usage_metadata
                    )

                if not chunk.candidates:
                    continue

                candidate = chunk.candidates[0]
                if not candidate.content or not candidate.content.parts:
                    continue

                for part in candidate.content.parts:
                    if part.text and getattr(part, "thought", False):
                        if not thinking_block_id:
                            thinking_block_id = uuid.uuid4().hex[:12]
                            yield StreamEvent(
                                type=EventType.THINKING_BLOCK_START,
                                block_id=thinking_block_id,
                            )
                        yield StreamEvent(
                            type=EventType.THINKING_BLOCK_DELTA,
                            block_id=thinking_block_id,
                            delta=part.text,
                        )
                    elif part.text:
                        if thinking_block_id:
                            yield StreamEvent(
                                type=EventType.THINKING_BLOCK_END,
                                block_id=thinking_block_id,
                            )
                            thinking_block_id = ""
                        if not text_block_id:
                            text_block_id = uuid.uuid4().hex[:12]
                            yield StreamEvent(
                                type=EventType.TEXT_BLOCK_START,
                                block_id=text_block_id,
                            )
                        accumulated_content += part.text
                        yield StreamEvent(
                            type=EventType.TEXT_BLOCK_DELTA,
                            block_id=text_block_id,
                            delta=part.text,
                        )
                    elif part.function_call:
                        if thinking_block_id:
                            yield StreamEvent(
                                type=EventType.THINKING_BLOCK_END,
                                block_id=thinking_block_id,
                            )
                            thinking_block_id = ""
                        tc_id = f"toolu_{uuid.uuid4().hex[:24]}"
                        fc_args = part.function_call.args
                        tc_metadata: dict = {}
                        if part.thought_signature:
                            tc_metadata["thought_signature"] = part.thought_signature
                        tc = ToolCall(
                            id=tc_id,
                            name=part.function_call.name or "",
                            input=dict(fc_args) if fc_args else {},
                            metadata=tc_metadata,
                        )
                        tool_calls.append(tc)
                        tool_block_id = uuid.uuid4().hex[:12]
                        yield StreamEvent(
                            type=EventType.TOOL_CALL_START,
                            block_id=tool_block_id,
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                        )
                        yield StreamEvent(
                            type=EventType.TOOL_CALL_END,
                            block_id=tool_block_id,
                            tool_call_id=tc.id,
                            tool_name=tc.name,
                            tool_args=tc.input,
                        )

            if not accumulated_content and not tool_calls and blocked:
                text_block_id = uuid.uuid4().hex[:12]
                accumulated_content = VISIBLE_REFUSAL_MESSAGE
                yield StreamEvent(type=EventType.TEXT_BLOCK_START, block_id=text_block_id)
                yield StreamEvent(
                    type=EventType.TEXT_BLOCK_DELTA,
                    block_id=text_block_id,
                    delta=accumulated_content,
                )

            if thinking_block_id:
                yield StreamEvent(type=EventType.THINKING_BLOCK_END, block_id=thinking_block_id)
            if text_block_id:
                yield StreamEvent(type=EventType.TEXT_BLOCK_END, block_id=text_block_id)

            yield StreamEvent(
                type=EventType.MODEL_CALL_END,
                model=model,
                input_tokens=prompt_tokens - cached_tokens,
                output_tokens=output_tokens,
                cache_read_input_tokens=cached_tokens,
                result=CompletionResult(
                    content=accumulated_content,
                    model=model,
                    input_tokens=prompt_tokens - cached_tokens,
                    output_tokens=output_tokens,
                    cache_read_input_tokens=cached_tokens,
                    tool_calls=tool_calls,
                    stop_reason=(
                        "tool_use" if tool_calls else ("refusal" if blocked else "end_turn")
                    ),
                ),
            )
        except Exception as e:
            logger.error(f"Google streaming error: {e}")
            yield StreamEvent(type=EventType.ERROR, error=str(e), error_exception=e)


def _enum_token(value: object) -> str:
    if value is None:
        return ""
    name = getattr(value, "name", None)
    if name:
        return str(name).upper()
    raw = getattr(value, "value", value)
    return str(raw).rsplit(".", 1)[-1].upper()


def _google_block_reason(response: Any) -> str:
    feedback = getattr(response, "prompt_feedback", None)
    reason = _enum_token(getattr(feedback, "block_reason", None))
    if reason and reason not in {"0", "BLOCK_REASON_UNSPECIFIED", "UNSPECIFIED"}:
        return reason
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return ""
    finish = _enum_token(getattr(candidates[0], "finish_reason", None))
    if finish in {
        "SAFETY",
        "RECITATION",
        "BLOCKLIST",
        "PROHIBITED_CONTENT",
        "SPII",
        "IMAGE_SAFETY",
    }:
        return finish
    return ""


def _google_stop_reason(
    response: Any,
    tool_calls: list[ToolCall],
    *,
    blocked: bool,
) -> str:
    if tool_calls:
        return "tool_use"
    if blocked:
        return "refusal"
    candidates = getattr(response, "candidates", None) or []
    if candidates and _enum_token(getattr(candidates[0], "finish_reason", None)) == "MAX_TOKENS":
        return "max_tokens"
    return "end_turn"


def _split_google_usage(usage_metadata) -> tuple[int, int, int]:
    """Return ``(prompt_tokens, cached_tokens, candidates_tokens)``.

    Gemini 2.5 Flash and Pro auto-cache common prefixes (implicit
    caching). The cached portion is reported under
    ``usage_metadata.cached_content_token_count`` and is a subset of
    ``prompt_token_count``. Splitting here lets the runtime store
    cache hits in the same shape used for Anthropic / OpenAI:
    ``input_tokens`` = uncached input, ``cache_read_input_tokens`` =
    cached subset.

    Returns zeros when ``usage_metadata`` is missing (older models /
    failed responses) or the cache field is absent.
    """
    if usage_metadata is None:
        return 0, 0, 0
    prompt_tokens = int(getattr(usage_metadata, "prompt_token_count", 0) or 0)
    candidates_tokens = int(getattr(usage_metadata, "candidates_token_count", 0) or 0)
    cached_tokens = int(getattr(usage_metadata, "cached_content_token_count", 0) or 0)
    cached_tokens = min(cached_tokens, prompt_tokens)
    return prompt_tokens, cached_tokens, candidates_tokens
