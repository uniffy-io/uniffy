"""Read-only catalog of agent templates used to seed default agents.

Entries are markdown files in `uniffy/data/catalog/`: frontmatter carries the
identity, tool, and skill wiring, the body is the soul prompt.
"""

from __future__ import annotations

from dataclasses import dataclass

from uniffy.core.data_files import DATA_DIR, load_documents


@dataclass(frozen=True)
class AgentTemplate:
    key: str
    name: str
    emoji: str
    description: str
    soul_prompt: str
    enabled_tools: list[str]
    bundled_skill_names: list[str]
    # Model ids the template works best on; prefill only, applied at create
    # time when an org key's provider actually serves them.
    recommended_model: str = ""
    recommended_image_model: str = ""
    # Seeds the org bootstrap default agent; exactly one template carries it.
    is_default: bool = False


def _load_catalog() -> tuple[AgentTemplate, ...]:
    ordered: list[tuple[int, AgentTemplate]] = []
    for doc in load_documents(DATA_DIR / "catalog"):
        ordered.append((
            int(doc.scalar("order")),
            AgentTemplate(
                key=doc.scalar("key"),
                name=doc.scalar("name"),
                emoji=doc.scalar("emoji"),
                description=doc.scalar("description"),
                soul_prompt=doc.body,
                enabled_tools=doc.items("tools"),
                bundled_skill_names=doc.items("skills"),
                recommended_model=str(doc.meta.get("recommended_model", "")),
                recommended_image_model=str(
                    doc.meta.get("recommended_image_model", "")
                ),
                is_default=str(doc.meta.get("default", "")).lower() == "true",
            ),
        ))

    ordered.sort(key=lambda entry: entry[0])
    return tuple(template for _, template in ordered)


AGENT_TEMPLATES: tuple[AgentTemplate, ...] = _load_catalog()


def get_template(key: str) -> AgentTemplate:
    for template in AGENT_TEMPLATES:
        if template.key == key:
            return template
    raise KeyError(key)


def get_default_template() -> AgentTemplate:
    """The template flagged `default: true`, else the lowest-order one."""
    for template in AGENT_TEMPLATES:
        if template.is_default:
            return template
    return AGENT_TEMPLATES[0]
