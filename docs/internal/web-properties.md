# Uniffy Web Properties

## Overview

Uniffy's public web presence is split into five domains, each serving a distinct purpose. The app itself lives at `cloud.uniffy.io`, while marketing, documentation, feedback, and status monitoring are separate services.

---

## Domains

| Domain | Purpose | Tech | Status |
|--------|---------|------|--------|
| `uniffy.io` | Marketing/landing page | Astro + Tailwind CSS 4 | Planned |
| `cloud.uniffy.io` | The Uniffy app | React 19 + Redux Toolkit + Tailwind CSS 4 | Active |
| `docs.uniffy.io` | Documentation site | Astro + Starlight | Planned |
| `feedback.uniffy.io` | Feature voting board | Fider (self-hosted) | Planned |
| `status.uniffy.io` | Status/uptime monitoring | Gatus (self-hosted) | Planned |

---

## 1. Landing Page - `uniffy.io`

**Tech:** Astro + Tailwind CSS 4

Astro is a static-first web framework that ships zero JavaScript by default. It supports React component islands where interactivity is needed, making it ideal for a marketing site that needs to be fast and SEO-friendly.

| Resource | URL |
|----------|-----|
| Astro | https://astro.build |
| Astro GitHub | https://github.com/withastro/astro |
| Astro Docs | https://docs.astro.build |
| Tailwind CSS 4 | https://tailwindcss.com |

**Why Astro over Next.js:** Mostly static content (pricing, features, about). Astro's zero-JS default means faster page loads and better Core Web Vitals. Next.js is overkill for a site that doesn't need SSR or client-side routing.

**Key pages:** Home, Features, Pricing, About, Blog (optional), Contact

---

## 2. Documentation - `docs.uniffy.io`

**Tech:** Astro + Starlight (same monorepo as landing page)

Starlight is Astro's official documentation plugin. It provides search, sidebar navigation, versioning, dark mode, and MDX support out of the box. Sharing a monorepo with the landing page means shared components, theme tokens, and a single deploy pipeline.

| Resource | URL |
|----------|-----|
| Starlight | https://starlight.astro.build |
| Starlight GitHub | https://github.com/withastro/starlight |
| Starlight Docs | https://starlight.astro.build/getting-started |

**Content structure:** Guides, API reference, changelog, integrations, self-hosting docs

---

## 3. Feature Voting - `feedback.uniffy.io`

**Tech:** Fider (self-hosted)

Fider is an open source feature voting platform where users propose features and others vote on what should be implemented. It provides the "UserVoice" pattern - propose, vote, comment, status updates.

| Resource | URL |
|----------|-----|
| Fider | https://fider.io |
| Fider GitHub | https://github.com/getfider/fider |
| Fider Docs | https://docs.fider.io |
| Fider Docker Hub | https://hub.docker.com/r/getfider/fider |

**Stack:** Go backend, TypeScript frontend, PostgreSQL 12+

**License:** AGPL-3.0

**Authentication options:**
- Built-in magic link email (no passwords)
- OAuth2 providers (Google, GitHub, Facebook)
- Custom OAuth2 provider (can integrate with Uniffy auth)
- Trusted SSO (Azure AD, Okta, Google Workspace)

**Deployment requirements:**
- PostgreSQL 12+ (can share existing or separate instance)
- Docker container (`getfider/fider`)
- SMTP server or Mailgun for email notifications
- Environment variables: `BASE_URL`, `DATABASE_URL`, `JWT_SECRET`, `EMAIL_NOREPLY`

**Integration with Uniffy auth:** Register Uniffy as a custom OAuth2 provider in Fider. This requires adding OAuth2 authorization server endpoints to the Uniffy backend so users can "Sign in with Uniffy" on the feedback board.

---

## 4. Status Page - `status.uniffy.io`

**Tech:** Gatus (self-hosted)

Gatus is a developer-oriented health dashboard and uptime monitor. It supports HTTP, TCP, DNS, and TLS checks with configurable alerting.

| Resource | URL |
|----------|-----|
| Gatus | https://gatus.io |
| Gatus GitHub | https://github.com/TwiN/gatus |
| Gatus Docker | `ghcr.io/twin/gatus:stable` |

**Stack:** Go backend, bundled frontend

**License:** Apache 2.0 (permissive - can modify, rebrand, use commercially, no copyleft)

**Deployment options:**
- Docker / Docker Compose
- Helm Chart / Kubernetes / Terraform
- Standalone binary

**Database:** PostgreSQL supported for persistent storage

**Alerting integrations:** Slack, Teams, PagerDuty, Discord, Twilio, Webhook, GitHub, GitLab, Email, AWS SES, Datadog, and 30+ others

**API:** REST API for programmatic access to uptime and response time data

**Branding/customization:** Limited built-in theming (dark mode, element visibility). Apache 2.0 license allows forking and full reskin - replace logo, colors, fonts to match Uniffy's design system. Fork maintenance cost: periodic upstream merges.

**What to monitor:**
- `cloud.uniffy.io` - The app (HTTP)
- `uniffy.io` - Landing page (HTTP)
- `docs.uniffy.io` - Documentation (HTTP)
- `feedback.uniffy.io` - Fider (HTTP)
- API health endpoint (HTTP)
- PostgreSQL (TCP)
- Meilisearch (HTTP)
- Valkey/Redis (TCP)
- S3-compatible storage (HTTP)

---

## 5. App - `cloud.uniffy.io`

The existing Uniffy application. No changes to the tech stack.

**Stack:** React 19, TypeScript, Vite, Redux Toolkit, Tailwind CSS 4, ConnectRPC

---

## Repository Strategy

| Property | Repository |
|----------|-----------|
| Landing + Docs | Single Astro monorepo (shared components/theme) |
| Feedback (Fider) | No custom repo needed (Docker deploy, config only) |
| Status (Gatus) | No custom repo needed unless forking for reskin |
| App | Existing `uniffy` repo |

---

## Infrastructure Dependencies

| Service | Required by | Notes |
|---------|-------------|-------|
| PostgreSQL | App, Fider, Gatus | Can share instance with separate databases or use dedicated instances |
| SMTP / Mailgun | Fider | Email notifications and magic link auth |
| Docker | Fider, Gatus | Container runtime for self-hosted services |
| DNS | All | Subdomains pointing to respective services |
| TLS/SSL | All | Certificates for all domains (Let's Encrypt or similar) |

---

## Future Considerations

- **Uniffy as OAuth2 provider:** Required for Fider SSO integration. Adds `/oauth/authorize` and `/oauth/token` endpoints to the backend.
- **Gatus reskin:** If the default UI doesn't match Uniffy's design language, fork and restyle the frontend. Apache 2.0 permits this.
- **Blog:** Can be added to the Astro landing site as a content collection. Useful for changelog, product updates, engineering posts.
