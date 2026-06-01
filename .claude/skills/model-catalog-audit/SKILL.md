---
name: model-catalog-audit
description: Audit the in-tree model catalog against each provider's live API (Anthropic, OpenAI, Google) using the keys in .env. Surfaces new models the catalog is missing and catalog models a provider no longer returns, so the catalog stays current. Run periodically or when a provider ships new models / changes pricing.
user_invocable: true
---

Keep `src/uniffy/domains/agents/providers/catalog/catalog.json` current by diffing
it against what the providers actually serve. The catalog is the source of truth
for the model list, pricing, capabilities, and image-gen support (see
`.claude/rules/agents.md`), so it drifts as providers ship and retire models.

## When to use

- Periodically (e.g. monthly) to catch new models and retirements.
- When someone reports a missing model, or a provider announces a launch.
- After a pricing change announcement (the audit finds the models; you research
  the prices).

## Steps

1. **Run the audit** from the repo root:

   ```bash
   uv run python .claude/skills/model-catalog-audit/audit_models.py
   ```

   It loads provider keys from `.env` (`CLAUDE_API_KEY`, `OPENAI_API_KEY`,
   `GOOGLE_GENAI_API_KEY`), lists each provider's live models, and diffs against
   the catalog. A provider with no key in `.env` is skipped. It is read-only -
   it never edits the catalog.

2. **Read the report.** Per provider:
   - **NEW** - a live model the catalog does not resolve. These are candidates
     to add. Expect noise from OpenAI/Google: embeddings, `tts-*`, `whisper-*`,
     `gpt-realtime-*`, `*-moderation`, `aqa`, `deep-research-*`, `computer-use-*`,
     `sora-*` are **not chat or image-generation models** - skip them unless we
     add a code path. Focus on chat models and image-gen models.
   - **UNSEEN** - a catalog model this key did not return. Often just means the
     account lacks access or it is a dated snapshot; do not delete blindly.

3. **Decide what to adopt.** For each NEW model worth adding (a real chat or
   image-gen model), and for any model whose pricing may have changed:
   - **Research capabilities + pricing on the web** - the APIs do not return
     pricing. Use the provider's official pricing/docs page (this is the same
     flow used to add the Gemini "Nano Banana" models). Record the source.
   - Confirm context window, max output tokens, vision/tools/reasoning support,
     and reasoning effort levels.

4. **Edit `catalog.json`** (catwalk-shaped - match existing entries):
   - Chat model: `id`, `name`, `cost_per_1m_in/out`, `cost_per_1m_in_cached`
     (cache write) + `cost_per_1m_out_cached` (cache read), `context_window`,
     `default_max_tokens`, `can_reason` (+ `reasoning_levels` /
     `default_reasoning_effort` when it reasons), `supports_attachments`.
   - Image model: set `supports_image_generation: true` and either
     `image_prices` (size/quality matrix) or `cost_per_image` (flat). Leave
     pricing out if genuinely unknown - the model is still selectable, cost just
     stays unrecorded.
   - Use `aliases` for `-preview` / `-latest` / dated variants that should
     resolve to one canonical entry.
   - For confirmed retirements, set `deprecated: true` and `sunset_date` rather
     than deleting, so existing references still resolve.

5. **Verify.** The loader re-reads on file change, so:

   ```bash
   uv run python -c "from uniffy.domains.agents.providers.catalog import loader; loader.load_catalog(); print('catalog valid')"
   uv run pytest src/uniffy/tests/test_pricing.py -q
   ```

   A malformed catalog raises on load (hard fail), so a clean load means the
   schema is satisfied.

6. **Ship it.** Commit the `catalog.json` change (and any newly-supported
   provider code). Open a PR with `/pr` if appropriate.

## Notes

- The script does not detect price changes (no API exposes pricing) - it only
  finds model-id drift. Pricing is always a manual web-research step.
- New entries are picked up live (mtime reload); no restart needed to test.
- Do not commit anything from `.env` or print key values.
