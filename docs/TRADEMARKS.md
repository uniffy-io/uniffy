# Trademark Notice

Uniffy bundles the name and logo of each LLM provider it can connect to, so a
user can tell at a glance which service an API key or model belongs to.

**All product names, logos, and brands are the property of their respective
owners.** They are used here for identification purposes only. Their use does
not imply any affiliation with, sponsorship by, or endorsement from the
trademark holder.

Uniffy is not affiliated with, endorsed by, or sponsored by any of the
providers listed below.

## Marks bundled with Uniffy

| Provider | Mark owner | Brand guidelines |
|---|---|---|
| OpenAI | OpenAI, Inc. | https://openai.com/brand |
| Anthropic (Claude) | Anthropic PBC | https://www.anthropic.com/legal/trademark-policy |
| Google (Gemini) | Google LLC | https://about.google/brand-resource-center/ |
| OpenRouter | OpenRouter, Inc. | https://openrouter.ai/ |
| xAI (Grok) | X.AI Corp. | https://x.ai/ |
| GitHub | GitHub, Inc. | https://github.com/logos |

The logo files themselves come from
[`@lobehub/icons-static-svg`](https://github.com/lobehub/lobe-icons) (MIT). The
MIT license covers that project's packaging of the artwork; it does not and
cannot grant rights in the underlying trademarks, which remain with the owners
above.

## Rules for contributors

- Do not alter a mark: no recoloring into the Uniffy palette, no cropping,
  distorting, rotating, or adding effects. Marks that ship monochrome are
  rendered in a single current text color so they stay legible on both themes,
  which is the one-color usage brand guidelines normally permit.
- Do not use a provider mark as the identity of a Uniffy feature - not as an
  agent avatar, a section icon, or anywhere it reads as our branding. Marks
  appear only where they identify that provider's own service: provider keys,
  model pickers, and the "runs on" badge.
- Check the provider's current brand guidelines before adding a new mark. The
  terms change, and the table above records where they were read from.
- Removing a brand is a one-line edit in
  `src/ui/src/features/agents/config/providerBrands.ts`. A provider that
  objects should be swapped to a plain text label there; nothing else needs to
  change, because every surface goes through `ProviderLogo`, which renders
  nothing for an unmapped provider.
