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
