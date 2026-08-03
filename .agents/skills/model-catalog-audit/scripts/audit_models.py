"""Audit the in-tree model catalog against each provider's live model list.

Loads provider API keys from ``.env``, lists the live models from Anthropic,
OpenAI, Google, OpenRouter, and xAI, and diffs them against
``src/uniffy/data/models/catalog.json`` via the catalog
loader (so aliases / dated snapshots resolve, not just exact ids). Keyed
providers report:

  NEW     - a live model the catalog does not resolve -> consider adding
  UNSEEN  - a catalog model this key did not return  -> verify before deprecating

OpenRouter is keyless and deliberately curated (the catalog tracks a small
subset of 400+ upstream models), so it reports MISSING UPSTREAM / PRICE DRIFT /
CONTEXT DRIFT instead of NEW. xAI adds PRICE DRIFT when its richer endpoint
reports pricing. Anthropic/OpenAI/Google return no pricing - price changes
there stay a manual research step (see SKILL.md). Read-only: it never edits
the catalog.

Run from the repo root via the stack-aware passthrough (add --stack local for a
host venv):  ./manage.py deps run -s backend run python .agents/skills/model-catalog-audit/scripts/audit_models.py
"""

from __future__ import annotations

import os
from decimal import Decimal

from dotenv import load_dotenv
from pyqwest import SyncClient

load_dotenv()

from uniffy.domains.agents.providers.catalog import get_model, models_for_provider

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
XAI_MODELS_URL = "https://api.x.ai/v1/models"
XAI_LANGUAGE_MODELS_URL = "https://api.x.ai/v1/language-models"
HTTP_TIMEOUT_SECONDS = 30.0

_PRICE_REL_TOLERANCE = Decimal("0.01")
_PRICE_ABS_TOLERANCE = Decimal("0.001")
_TOKENS_PER_1M = Decimal(1_000_000)

# Catalog cache convention (see catalog/schema.py): cost_per_1m_in_cached is
# the cache-write rate, cost_per_1m_out_cached is the cache-read rate.
_OPENROUTER_PRICE_KEYS = {
    "prompt": "cost_per_1m_in",
    "completion": "cost_per_1m_out",
    "input_cache_write": "cost_per_1m_in_cached",
    "input_cache_read": "cost_per_1m_out_cached",
}

# xAI reports token prices in units of 1/10000 USD per 1M tokens
# (20000 -> $2.00 per 1M).
_XAI_PRICE_DIVISOR = Decimal(10000)
_XAI_PRICE_KEYS = {
    "prompt_text_token_price": "cost_per_1m_in",
    "completion_text_token_price": "cost_per_1m_out",
    "cached_prompt_text_token_price": "cost_per_1m_out_cached",
}


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


def _openrouter_live() -> list[dict]:
    client = SyncClient()
    out: list[dict] = []
    url: str | None = OPENROUTER_MODELS_URL
    while url:
        response = client.get(url, timeout=HTTP_TIMEOUT_SECONDS)
        if response.status != 200:
            raise RuntimeError(f"GET {url} -> HTTP {response.status}")
        payload = response.json()
        for item in payload.get("data") or []:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            entry: dict = {"id": item["id"], "name": item.get("name") or ""}
            pricing = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
            prices: dict[str, Decimal] = {}
            for key, field in _OPENROUTER_PRICE_KEYS.items():
                raw = pricing.get(key)
                if raw not in (None, ""):
                    prices[field] = Decimal(str(raw)) * _TOKENS_PER_1M
            if prices:
                entry["prices"] = prices
            if isinstance(item.get("context_length"), int):
                entry["context_length"] = item["context_length"]
            out.append(entry)
        url = (payload.get("links") or {}).get("next")
    return out


def _xai_rich_models(payload: object) -> list[dict] | None:
    """Parse /v1/language-models; None on an unexpected shape (caller falls back)."""
    if not isinstance(payload, dict) or not isinstance(payload.get("models"), list):
        return None
    out: list[dict] = []
    for item in payload["models"]:
        if not isinstance(item, dict) or not item.get("id"):
            return None
        entry: dict = {"id": item["id"], "name": ""}
        prices: dict[str, Decimal] = {}
        for key, field in _XAI_PRICE_KEYS.items():
            raw = item.get(key)
            if isinstance(raw, (int, float)):
                prices[field] = Decimal(str(raw)) / _XAI_PRICE_DIVISOR
        if prices:
            entry["prices"] = prices
        out.append(entry)
    return out


def _xai_live() -> list[dict] | None:
    key = os.getenv("XAI_API_KEY")
    if not key:
        return None
    client = SyncClient()
    headers = {"authorization": f"Bearer {key}"}
    rich = client.get(XAI_LANGUAGE_MODELS_URL, headers=headers, timeout=HTTP_TIMEOUT_SECONDS)
    if rich.status == 200:
        try:
            models = _xai_rich_models(rich.json())
        except ValueError:
            models = None
        if models is not None:
            return models
    plain = client.get(XAI_MODELS_URL, headers=headers, timeout=HTTP_TIMEOUT_SECONDS)
    if plain.status != 200:
        raise RuntimeError(f"GET {XAI_MODELS_URL} -> HTTP {plain.status}")
    return [
        {"id": m["id"], "name": ""}
        for m in plain.json().get("data") or []
        if isinstance(m, dict) and m.get("id")
    ]


_PROVIDERS = {
    "anthropic": _anthropic_live,
    "openai": _openai_live,
    "google": _google_live,
    "openrouter": _openrouter_live,
    "xai": _xai_live,
}


def _fmt(value: Decimal) -> str:
    return format(value.normalize(), "f")


def _price_matches(catalog: Decimal, live: Decimal) -> bool:
    """Dual tolerance absorbs rounding noise (0.0833 vs 0.08333...)."""
    diff = abs(catalog - live)
    if diff <= _PRICE_ABS_TOLERANCE:
        return True
    return diff <= max(abs(catalog), abs(live)) * _PRICE_REL_TOLERANCE


def _print_price_drift(provider: str, live_by_id: dict[str, dict]) -> None:
    lines: list[str] = []
    for model in models_for_provider(provider):
        for slug in (model.id, *model.aliases):
            prices = (live_by_id.get(slug) or {}).get("prices")
            if not prices:
                continue
            for field, live_rate in prices.items():
                catalog_rate = getattr(model, field)
                if not _price_matches(catalog_rate, live_rate):
                    lines.append(
                        f"    ! {slug} {field}: catalog {_fmt(catalog_rate)} "
                        f"vs live {_fmt(live_rate)}"
                    )
    if lines:
        print("  PRICE DRIFT (USD per 1M tokens):")
        for line in lines:
            print(line)
    else:
        print("  PRICE DRIFT: none")


def _print_context_drift(provider: str, live_by_id: dict[str, dict]) -> None:
    lines: list[str] = []
    for model in models_for_provider(provider):
        for slug in (model.id, *model.aliases):
            live_ctx = (live_by_id.get(slug) or {}).get("context_length")
            if isinstance(live_ctx, int) and live_ctx != model.context_window:
                lines.append(f"    ! {slug}: catalog {model.context_window} vs live {live_ctx}")
    if lines:
        print("  CONTEXT DRIFT (catalog context_window vs live context_length):")
        for line in lines:
            print(line)
    else:
        print("  CONTEXT DRIFT: none")


def _report_openrouter(live: list[dict]) -> None:
    """Curated-subset report: NEW would be hundreds of lines of noise, so the
    diff runs catalog-first instead - slugs gone upstream plus price/context
    drift on the entries we track."""
    live_by_id = {m["id"]: m for m in live}
    slugs = [slug for m in models_for_provider("openrouter") for slug in (m.id, *m.aliases)]
    print(f"  catalog: {len(slugs)} slug(s) | live: {len(live_by_id)}")
    missing = sorted(slug for slug in slugs if slug not in live_by_id)
    if missing:
        print("  MISSING UPSTREAM (verify, then replace or deprecate):")
        for slug in missing:
            print(f"    ? {slug}")
    else:
        print("  MISSING UPSTREAM: none")
    _print_price_drift("openrouter", live_by_id)
    _print_context_drift("openrouter", live_by_id)


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

        if provider == "openrouter":
            _report_openrouter(live)
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
        if any(m.get("prices") for m in live):
            _print_price_drift(provider, {m["id"]: m for m in live})

    print(f"\n{'=' * 64}")
    print(
        f"{new_total} new model(s) across providers. For any you adopt: add to "
        "catalog.json and research pricing (anthropic/openai/google APIs do not "
        "return it)."
    )
    print(f"{'=' * 64}")
    return new_total


if __name__ == "__main__":
    audit()
