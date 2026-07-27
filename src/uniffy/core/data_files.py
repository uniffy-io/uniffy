"""Reader for the shipped content under `uniffy/data/`."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from loguru import logger

logger = logger.bind(component="core.data_files")

DATA_DIR = Path(__file__).resolve().parents[1] / "data"

FrontmatterValue = str | list[str]


@dataclass(frozen=True)
class DataDocument:
    path: Path
    meta: dict[str, FrontmatterValue]
    body: str

    def scalar(self, key: str) -> str:
        value = self.meta[key]
        if isinstance(value, list):
            raise ValueError(f"{self.path.name}: '{key}' is a list, expected a scalar")
        return value

    def items(self, key: str) -> list[str]:
        value = self.meta.get(key, [])
        if isinstance(value, str):
            raise ValueError(f"{self.path.name}: '{key}' is a scalar, expected a list")
        return list(value)


def parse_frontmatter(text: str) -> dict[str, FrontmatterValue]:
    """Scalars plus `- item` block lists; avoids a PyYAML dep for this subset."""
    result: dict[str, FrontmatterValue] = {}
    current_list: list[str] | None = None

    for raw_line in text.strip().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        if line.startswith("- "):
            if current_list is not None:
                current_list.append(line[2:].strip())
            continue

        if ":" not in line:
            continue

        key, _, value = line.partition(":")
        value = value.strip()
        if value:
            result[key.strip()] = value
            current_list = None
        else:
            current_list = []
            result[key.strip()] = current_list

    return result


def load_documents(directory: Path) -> list[DataDocument]:
    """Load every `*.md` in `directory`, sorted by filename."""
    documents: list[DataDocument] = []
    if not directory.is_dir():
        return documents

    for md_file in sorted(directory.glob("*.md")):
        raw = md_file.read_text(encoding="utf-8")

        if not raw.startswith("---"):
            logger.warning(f"Data file {md_file.name} missing YAML frontmatter, skipping")
            continue

        parts = raw.split("---", 2)
        if len(parts) < 3:
            logger.warning(f"Data file {md_file.name} has malformed frontmatter, skipping")
            continue

        documents.append(
            DataDocument(
                path=md_file,
                meta=parse_frontmatter(parts[1]),
                body=parts[2].strip(),
            )
        )

    return documents
