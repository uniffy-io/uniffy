"""Platform workspace section of every agent system prompt.

This is infrastructure, not user content: URN mention syntax, tool and memory
conventions, and content-creation rules the renderer depends on.
"""

from __future__ import annotations

from uniffy.core.data_files import DATA_DIR

# Text is shipped as markdown so it stays editable without touching python.
_PROMPT_PATH = DATA_DIR / "prompts" / "workspace.md"

WORKSPACE_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")
