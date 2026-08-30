"""Tests for vision-capability gating in the agent runtime.

When the resolved model does not support image input, image attachments
must fall back to a structured text note so the LLM can tell the user
the model cannot view images. Documents and extracted text are
unaffected by the vision flag.
"""

from types import SimpleNamespace

import pytest

from uniffy.core.types import generate_id
from uniffy.domains.agents.runtime.context.messages import (
    file_to_content_block,
    resolve_supports_vision,
)
from uniffy.domains.agents.runtime.files import FileContext


def _image(filename: str = "screenshot.png", mime: str = "image/png") -> FileContext:
    return FileContext(
        file_id=str(generate_id()),
        media_type=mime,
        filename=filename,
        storage_key=f"files/{generate_id()}.png",
        extracted_text=None,
        extraction_status="completed",
    )


def _pdf() -> FileContext:
    return FileContext(
        file_id=str(generate_id()),
        media_type="application/pdf",
        filename="contract.pdf",
        storage_key=f"files/{generate_id()}.pdf",
        extracted_text=None,
        extraction_status="completed",
    )


def _text_extracted() -> FileContext:
    return FileContext(
        file_id=str(generate_id()),
        media_type="text/plain",
        filename="notes.txt",
        storage_key=f"files/{generate_id()}.txt",
        extracted_text="hello world",
        extraction_status="completed",
    )


class TestImageBlockGating:
    def test_image_passes_through_when_vision_supported(self) -> None:
        block = file_to_content_block(_image(), supports_vision=True)
        assert block["type"] == "image"
        assert block["media_type"] == "image/png"
        assert "storage_key" in block

    def test_image_falls_back_to_text_when_vision_unsupported(self) -> None:
        block = file_to_content_block(
            _image(filename="diagram.jpg", mime="image/jpeg"),
            supports_vision=False,
        )
        assert block["type"] == "text"
        assert "diagram.jpg" in block["text"]
        assert "image/jpeg" in block["text"]
        assert "does not support image input" in block["text"]

    def test_image_default_assumes_vision_capable(self) -> None:
        block = file_to_content_block(_image())
        assert block["type"] == "image"


class TestNonImageUnaffectedByVisionFlag:
    def test_pdf_unchanged_when_vision_unsupported(self) -> None:
        block = file_to_content_block(_pdf(), supports_vision=False)
        assert block["type"] == "document"
        assert block["media_type"] == "application/pdf"
        assert block["filename"] == "contract.pdf"

    def test_extracted_text_unchanged_when_vision_unsupported(self) -> None:
        block = file_to_content_block(_text_extracted(), supports_vision=False)
        assert block["type"] == "text"
        assert "hello world" in block["text"]


class TestResolveSupportsVision:
    async def test_returns_model_flag_when_present(self) -> None:
        models = [
            SimpleNamespace(id="claude-opus-4-7", supports_vision=True),
            SimpleNamespace(id="o1-mini", supports_vision=False),
        ]

        class _Provider:
            async def get_available_models(self):
                return models

        assert await resolve_supports_vision(_Provider(), "o1-mini") is False
        assert await resolve_supports_vision(_Provider(), "claude-opus-4-7") is True

    async def test_unknown_model_defaults_to_true(self) -> None:
        class _Provider:
            async def get_available_models(self):
                return [SimpleNamespace(id="claude-opus-4-7", supports_vision=True)]

        # Unknown id should default to True so we don't silently drop attachments
        # on newly-released models the catalog hasn't been updated for yet.
        assert await resolve_supports_vision(_Provider(), "claude-opus-5") is True

    async def test_provider_lookup_failure_defaults_to_true(self) -> None:
        class _Provider:
            async def get_available_models(self):
                raise RuntimeError("provider exploded")

        assert await resolve_supports_vision(_Provider(), "claude-opus-4-7") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
