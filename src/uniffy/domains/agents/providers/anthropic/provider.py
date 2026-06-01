"""Anthropic LLM provider implementation using the official SDK."""

from collections.abc import AsyncIterator

import anthropic
from loguru import logger

from uniffy.domains.agents.providers.base import (
    CompletionResult,
    DoneEvent,
    ErrorEvent,
    LLMProvider,
    ModelInfo,
    StreamEvent,
    TokenEvent,
    ToolCall,
    ToolCallEvent,
)
from uniffy.domains.agents.providers.catalog import model_infos_for_provider

logger = logger.bind(component="agents.providers.anthropic.provider")


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider using the official Python SDK.

    Works with both API keys and setup tokens (Claude Max subscriptions).
    API keys (``sk-ant-api03-``) are passed via ``api_key``, while setup/OAuth
    tokens (``sk-ant-oat01-``) are passed via ``auth_token`` so the SDK uses
    the correct authorization header.

    Parameters
    ----------
    credential : str
        API key or setup token.
    credential_type : str
        Either "api_key" or "setup_token".

    """

    # Beta headers required for OAuth setup token authentication
    OAUTH_BETA_HEADERS = {
        "anthropic-beta": "oauth-2025-04-20",
    }

    def __init__(self, credential: str, credential_type: str = "api_key") -> None:
        self._credential_type = credential_type
        if credential_type == "setup_token":
            self._client = anthropic.AsyncAnthropic(
                auth_token=credential,
                default_headers=self.OAUTH_BETA_HEADERS,
            )
        else:
            self._client = anthropic.AsyncAnthropic(api_key=credential)

    async def validate(self) -> tuple[bool, str | None]:
        """Validate the credential against the Anthropic API.

        For API keys, uses the models.list endpoint. For setup tokens
        (OAuth), uses a minimal messages.create call with count_tokens
        since the models endpoint does not accept OAuth authentication.

        Returns
        -------
        tuple[bool, str | None]
            (True, None) if valid, (False, error_message) otherwise.

        """
        try:
            if self._credential_type == "setup_token":
                await self._client.messages.count_tokens(
                    model="claude-sonnet-4-20250514",
                    messages=[{"role": "user", "content": "hi"}],
                )
            else:
                await self._client.models.list(limit=1)
            return True, None
        except anthropic.AuthenticationError as e:
            return False, f"Authentication failed: {e}"
        except anthropic.PermissionDeniedError as e:
            return False, f"Permission denied: {e}"
        except anthropic.RateLimitError as e:
            # Rate limited but credentials are valid
            logger.warning(f"Rate limited during validation: {e}")
            return True, None
        except Exception as e:
            return False, f"Validation error: {e}"

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
        """Send a chat completion request to the Anthropic API.

        Parameters
        ----------
        messages : list[dict]
            Messages in Anthropic format.
        model : str
            Model identifier (e.g. "claude-opus-4-6").
        system : str | None
            System prompt passed as top-level parameter.
        tools : list[dict] | None
            Anthropic tool definitions.
        stream : bool
            Whether to stream the response.

        Returns
        -------
        CompletionResult | AsyncIterator[StreamEvent]
            Result or streaming iterator.

        """
        kwargs = self._build_request_kwargs(
            messages=messages,
            model=model,
            system=system,
            tools=tools,
        )

        if stream:
            return self._stream_completion(**kwargs)

        return await self._sync_completion(**kwargs)

    async def get_available_models(
        self,
        *,
        force_refresh: bool = False,
    ) -> list[ModelInfo]:
        """Return Anthropic models from the catalog (the source of truth).

        ``force_refresh`` is accepted for interface compatibility and ignored
        - the catalog is local and re-read on change.
        """
        return model_infos_for_provider("anthropic")

    def _build_request_kwargs(
        self,
        *,
        messages: list[dict],
        model: str,
        system: str | None,
        tools: list[dict] | None,
    ) -> dict:
        """Build the kwargs dict for the messages.create() call.

        Caching: render order is ``tools -> system -> messages``. A
        single ``cache_control: ephemeral`` breakpoint on the last
        system block covers BOTH tools and system in one cache entry,
        so subsequent turns within the cache TTL pay ~10% of the input
        price for that prefix. We do not put a separate breakpoint on
        the last tool -- it would write a redundant second cache entry
        (paying the 1.25x write premium twice on the first turn) for
        the same coverage.

        Parameters
        ----------
        messages : list[dict]
            Conversation messages.
        model : str
            Model identifier.
        system : str | None
            System prompt (top-level parameter).
        tools : list[dict] | None
            Tool definitions.

        Returns
        -------
        dict
            Keyword arguments for the API call.

        """
        clean_messages = self._clean_messages(messages)

        kwargs: dict = {
            "model": model,
            "messages": clean_messages,
            "max_tokens": 8192,
        }

        if system:
            kwargs["system"] = [
                {
                    "type": "text",
                    "text": system,
                    "cache_control": {"type": "ephemeral"},
                }
            ]

        if tools:
            kwargs["tools"] = list(tools)

        return kwargs

    @staticmethod
    def _clean_messages(messages: list[dict]) -> list[dict]:
        """Clean messages for the Anthropic API.

        - Remove tool_name from tool_result blocks (Anthropic rejects extra fields)
        - Convert canonical image/document blocks to Anthropic source format

        """
        cleaned: list[dict] = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                new_content = []
                for block in content:
                    if not isinstance(block, dict):
                        new_content.append(block)
                        continue
                    btype = block.get("type")
                    if btype == "tool_result":
                        block = {k: v for k, v in block.items() if k != "tool_name"}
                        new_content.append(block)
                    elif btype == "image" and "data" in block:
                        new_content.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": block["media_type"],
                                "data": block["data"],
                            },
                        })
                    elif btype == "document" and "data" in block:
                        new_content.append({
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": block["media_type"],
                                "data": block["data"],
                            },
                        })
                    else:
                        new_content.append(block)
                cleaned.append({**msg, "content": new_content})
            else:
                cleaned.append(msg)
        return cleaned

    async def _sync_completion(self, **kwargs) -> CompletionResult:
        """Execute a non-streaming completion.

        Parameters
        ----------
        **kwargs
            Arguments for messages.create().

        Returns
        -------
        CompletionResult
            The completion result.

        """
        response = await self._client.messages.create(**kwargs)

        content = ""
        tool_calls: list[ToolCall] = []

        for block in response.content:
            if block.type == "text":
                content += block.text
            elif block.type == "tool_use":
                tool_calls.append(
                    ToolCall(
                        id=block.id,
                        name=block.name,
                        input=block.input if isinstance(block.input, dict) else {},
                    )
                )

        return CompletionResult(
            content=content,
            model=response.model,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cache_creation_input_tokens=int(
                getattr(response.usage, "cache_creation_input_tokens", 0) or 0
            ),
            cache_read_input_tokens=int(
                getattr(response.usage, "cache_read_input_tokens", 0) or 0
            ),
            tool_calls=tool_calls,
            stop_reason=response.stop_reason or "end_turn",
        )

    async def _stream_completion(self, **kwargs) -> AsyncIterator[StreamEvent]:
        """Execute a streaming completion.

        Parameters
        ----------
        **kwargs
            Arguments for messages.create().

        Yields
        ------
        StreamEvent
            Stream events as they arrive.

        """
        try:
            async with self._client.messages.stream(**kwargs) as stream:
                accumulated_content = ""
                tool_calls: list[ToolCall] = []

                async for event in stream:
                    if event.type == "content_block_delta":
                        if hasattr(event.delta, "text"):
                            accumulated_content += event.delta.text
                            yield TokenEvent(text=event.delta.text)
                        elif hasattr(event.delta, "partial_json"):
                            pass  # Tool input being built incrementally
                    elif event.type == "content_block_stop":
                        is_tool_block = (
                            hasattr(event, "content_block")
                            and event.content_block.type == "tool_use"
                        )
                        if is_tool_block:
                            block = event.content_block
                            tc = ToolCall(
                                id=block.id,
                                name=block.name,
                                input=block.input if isinstance(block.input, dict) else {},
                            )
                            tool_calls.append(tc)
                            yield ToolCallEvent(tool_call=tc)

                final_message = await stream.get_final_message()
                yield DoneEvent(
                    result=CompletionResult(
                        content=accumulated_content,
                        model=final_message.model,
                        input_tokens=final_message.usage.input_tokens,
                        output_tokens=final_message.usage.output_tokens,
                        cache_creation_input_tokens=int(
                            getattr(
                                final_message.usage,
                                "cache_creation_input_tokens",
                                0,
                            )
                            or 0
                        ),
                        cache_read_input_tokens=int(
                            getattr(
                                final_message.usage,
                                "cache_read_input_tokens",
                                0,
                            )
                            or 0
                        ),
                        tool_calls=tool_calls,
                        stop_reason=final_message.stop_reason or "end_turn",
                    )
                )
        except Exception as e:
            logger.error(f"Anthropic streaming error: {e}")
            yield ErrorEvent(error=str(e))
