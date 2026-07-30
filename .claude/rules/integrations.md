---
paths:
  - "src/uniffy/domains/integrations/**"
  - "src/proto/integrations/**"
  - "src/ui/src/features/integrations/**"
  - "src/ui/src/features/admin/components/integrations/**"
---

# Integrations Domain

Org-wide credentials for external services (GitHub first) plus the agent tool packs that use them. The slice generalizes the LLM provider-key slice: same trust model, same caching discipline, same admin surface shape. Protos in `src/proto/integrations/v1/`, model in `core/models/integrations/`, domain in `domains/integrations/`, admin UI at `/admin/integrations`.

## Invariants

- **Connections are not content.** No URN, no ContentType, no search indexing, no `access_mode`, no `ContentMember` rows, no sharing dialog. Every enabled connection is usable by every org member THROUGH an agent whose builder enabled the tools. Add/update/toggle/validate/remove gate on `require_org_admin`; list is member-level with `last_error` riding only for admins (`include_diagnostics`).
- **Gate before load.** Admin mutations check `require_org_admin` BEFORE loading the row, so a non-admin cannot probe cross-org connection ids for existence.
- **Decrypted credentials never enter Valkey.** Rows are `OrgCipher`-encrypted with a per-table `ReEncryptingConsumer`. The in-process `IntegrationClientLRU` is the only place a decrypted credential lives; Valkey holds only non-secret metadata (`integrations:org:{org_id}`). Mutations publish `integration_connections:invalidate:{id}` and drop the org metadata key in the same operation; the PSUBSCRIBE listener runs in the web lifespan AND `egress_on_startup` (agent runs execute in the egress fleet).
- **The admin-set `base_url` is the only host source.** `NULL` means the provider's cloud default; a value points at a self-hosted instance (GitHub Enterprise Server is `https://HOST/api/v3`). That an admin can target a private address is intended, the same trust as SMTP settings. Agent input reaches URLs only through `encode_segment` path pieces and `params` mappings, never the host. Arbitrary-URL fetching stays out of this domain.
- **Live probe is the only credential check.** No format validation; probe on add and on demand, failure stored on `is_valid` + `last_error`, row kept. A 401 during a tool call auto-demotes the connection (`mark_connection_invalid`).
- **Tools are advertised only when usable and re-checked at call time.** `filter_integration_tool_schemas` runs after `apply_image_tool_schema` at both `_resolve_tool_schemas` sites, dropping a provider's tools when the org has no enabled+valid connection and write tools unless a connection has `allow_writes`. The executor path re-resolves the connection and re-checks `allow_writes` as the backstop.
- **Writes are double-gated.** `allow_writes` (default false, admin-controlled) is the load-bearing gate because the non-streaming loop has no approval step; `destructive=True` adds the chat approval card. The current GitHub pack is read-only; any future write tool ships with both gates.
- **External text is scrubbed and framed.** Every external string goes through `format.py` (`scrub_external_text` / `scrub_external_code`): mention markup collapses to its label, bidi/zero-width controls are stripped, fields are capped. Results are compact shaped markdown, never raw API JSON, and every result opens with a `Source: {provider} connection "{name}" ({host})` line. When integration tools are advertised, the system prompt gains the external-content note.
- **pyqwest only.** `IntegrationHttpClient` is the shared transport core: per-connection circuit breaker, `asyncio.wait_for` timeout, 2MB response cap, typed error taxonomy (401 auth, 403/429 rate-limit mapping to `RateLimitExceededError` with `retry_after`, 404 `NotFoundError`), error text truncated and never containing the credential. No vendor SDKs, no httpx.
- **Multiple connections per (org, provider).** Unique on `(organization_id, provider, name)`. Resolution precedence at call time: explicit `connection` tool argument, then the agent's pin (`Agent.integration_connections`, provider id -> connection id, edited via the always-visible Connection select on the Capabilities tab group), then single-connection auto; ambiguity and absence return recovery copy that names the fix (error-driven recovery is the tool-loop contract). The pin is routing, not security: connections carry no access policy, so pinning never restricts what a member could reach anyway.

## Adding an integration

| # | Where | What |
|---|---|---|
| 1 | `domains/integrations/providers/{name}/` | `IntegrationDescriptor` + `IntegrationProvider` (probe = cheapest authenticated read), client wrapper over `IntegrationHttpClient`, tool pack |
| 2 | `registry.py::get_integration_registry` | Register the provider (lazy import) |
| 3 | Tool pack | `{name}.{verb_object}` naming (dots and underscores only, never hyphens), reads `read_only=True` + `timeout_seconds=30`, writes `destructive=True` + `allow_writes` check, every external string through `format.py`, source line on every result, optional `connection` arg, `limit` default 20 max 50 |
| 4 | `src/ui/src/features/agents/config/toolCatalog.ts` | Group in the `external` section with `requiresConnection: '{name}'` |
| 5 | `src/ui/src/features/integrations/config/integrationBrands.ts` | Mark + label (phosphor or bundled asset; never a CDN fetch) |
| 6 | `docs/TRADEMARKS.md` | Owner + brand-guideline row |
| 7 | Tests | Definition assertions, client URL/error tests, executor connection-resolution matrix |

Provider marks are trademarks: never restyle into the palette, never use as a Uniffy feature identity; they appear only where they identify the connected service.
