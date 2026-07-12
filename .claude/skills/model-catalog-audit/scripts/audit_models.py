"""Audit the in-tree model catalog against each provider's live model list.

Loads provider API keys from ``.env``, lists the live models from Anthropic,
OpenAI, and Google, and diffs them against
``src/uniffy/domains/agents/providers/catalog/catalog.json`` via the catalog
loader (so aliases / dated snapshots resolve, not just exact ids). Reports per
provider:

  NEW     - a live model the catalog does not resolve -> consider adding
  UNSEEN  - a catalog model this key did not return  -> verify before deprecating

Providers DO NOT return pricing, so this script can't detect price changes; new
models you adopt need their pricing researched by hand (see SKILL.md). Read-only:
it never edits the catalog.

Run from the repo root via the stack-aware passthrough (add --stack local for a
host venv):  ./manage.py deps run -s backend run python .claude/skills/model-catalog-audit/scripts/audit_models.py
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from uniffy.domains.agents.providers.catalog import get_model, models_for_provider


def _anthropic_live() -> list[dict] | None:
    key = os.getenv("CLAUDE_API_KEY") or os.getenv("ANTHROPIC_API_KEY")
    if not key:
        return None
    import anthropic

    client = anthropic.Anthropic(api_key=key)
    return [
        {"id": m.id, "name": getattr(m, "display_name", "") or ""}
        for m in client.models.list(limit=1000)
    ]


def _openai_live() -> list[dict] | None:
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    import openai

    client = openai.OpenAI(api_key=key)
    return [{"id": m.id, "name": ""} for m in client.models.list().data]


def _google_live() -> list[dict] | None:
    key = os.getenv("GOOGLE_GENAI_API_KEY")
    if not key:
        return None
    from google import genai

    client = genai.Client(api_key=key)
    out: list[dict] = []
    for m in client.models.list():
        clean_id = (m.name or "").removeprefix("models/")
        if not clean_id:
            continue
        out.append(
            {
                "id": clean_id,
                "name": m.display_name or "",
                "actions": list(getattr(m, "supported_actions", None) or []),
            }
        )
    return out


_PROVIDERS = {
    "anthropic": _anthropic_live,
    "openai": _openai_live,
    "google": _google_live,
}


def audit() -> int:
    """Print the catalog/live diff for each provider; return the NEW count."""
    new_total = 0
    for provider, lister in _PROVIDERS.items():
        print(f"\n{'=' * 64}\n{provider.upper()}\n{'=' * 64}")
        try:
            live = lister()
        except Exception as exc:  # noqa: BLE001 - report and move on
            print(f"  ERROR listing {provider}: {exc}")
            continue
        if live is None:
            print("  no API key in .env - skipped")
            continue

        catalog_ids = {m.id for m in models_for_provider(provider)}
        live_ids = {m["id"] for m in live}
        new = sorted(
            (m for m in live if get_model(provider, m["id"]) is None),
            key=lambda m: m["id"],
        )
        unseen = sorted(catalog_ids - live_ids)

        print(f"  catalog: {len(catalog_ids)} | live: {len(live_ids)}")
        if new:
            new_total += len(new)
            print("  NEW (not in catalog - consider adding):")
            for m in new:
                label = f" - {m['name']}" if m["name"] else ""
                actions = f"  actions={m['actions']}" if m.get("actions") else ""
                print(f"    + {m['id']}{label}{actions}")
        else:
            print("  NEW: none")
        if unseen:
            print("  UNSEEN by this key (verify before deprecating):")
            for mid in unseen:
                print(f"    ? {mid}")

    print(f"\n{'=' * 64}")
    print(
        f"{new_total} new model(s) across providers. For any you adopt: add to "
        "catalog.json and research pricing (the APIs don't return it)."
    )
    print(f"{'=' * 64}")
    return new_total


if __name__ == "__main__":
    audit()
