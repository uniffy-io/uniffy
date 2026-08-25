# Security

If you think you found a security issue in Uniffy, this page tells you how to reach us privately and what happens after you do.

## Reporting a vulnerability

**Do not open a public issue for anything exploitable.** A public issue is a disclosure, and every self hosted deployment is exposed until there is a fix to install.

Use either private channel:

1. **GitHub private vulnerability reporting**, from the Security tab of this repository. Preferred.
2. **security@uniffy.io** if you would rather use email.

If a report needs encryption, send a first message with no details and we will give you a key.

Include what you can: what the issue is, where it lives, how to reproduce it, what an attacker gets, and whether you found it on `cloud.uniffy.io` or self hosted. Redact real user data and real tokens from anything you send.

## What happens next

We are a small team, so these are honest targets rather than a contract. We acknowledge within 3 business days, confirm or dispute within 10, and ship fixes for critical and high severity within 30 days of confirmation. Public advisory once a fix is available, or at 90 days, whichever comes first.

If we go quiet past those windows, chase us. That is a failure on our side, not an invitation to disclose. We credit reporters in the advisory unless you ask us not to. We do not run a paid bounty today.

## Scope

In scope: this repository, the backend, the browser app, the mobile app, `unictl`, the deployment tooling, and `cloud.uniffy.io`.

Out of scope: dependency vulnerabilities with no exploitable path through Uniffy, findings that require the attacker to already be an org admin of the tenant they attack, scanner output with no demonstrated impact, social engineering, and anything requiring a fully compromised device.

Hardening gaps, dependency CVEs, and policy questions that are safe to discuss in the open belong in a `[SECURITY]` issue instead. The template exists for exactly that.

## Supported versions

Uniffy is pre 1.0 with no long term support branches yet. Security fixes land on `main` and in the next release. If you self host, run a recent build.

## What you can hold us to

- Platform operators get no automatic access to tenant content. Reaching it takes a time bound, audit logged support session the org owner can see and revoke.
- Org admins get no content bypass. Personal content is private until shared.
- Per organization secrets are encrypted with a key that belongs to that organization.
- Telemetry is off by default and a fully isolated deployment is supported. 

A path around any of those is a critical finding, regardless of anything else on this page.
