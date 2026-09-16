---
title: Behind an Edge
description: Running Cloudflare, a CDN, a WAF, or a corporate load balancer in front of Uniffy. What must pass untouched, what to switch off, and where the TURN record must never point.
sidebar:
  label: Behind an Edge
  order: 10
---

Plenty of deployments put something in front of Uniffy: Cloudflare for DDoS cover, a corporate WAF because policy says so, a load balancer that terminates all company TLS. All of that can work. This page is the contract an edge has to honor, the Cloudflare specifics, and the two mistakes that produce an app that looks healthy while parts of it quietly die.

## The rules for any edge

Uniffy's traffic is streams, websockets, and calls media, not just request and response. Whatever sits in front must:

1. Pass websockets. The realtime connection rides one.
2. Stream response bodies without buffering. Agent replies arrive token by token; an edge that collects the response before forwarding it turns a live answer into a dead wait.
3. Keep idle timeouts generous on `/api` paths. A quiet stream is not a stuck stream.
4. Never inject scripts into pages. Uniffy ships a content security policy locked to its own origin, so any edge feature that rewrites HTML to add its own JavaScript breaks the app instantly.
5. Never challenge API clients. Browser challenges and bot interstitials on `/api` lock out the mobile app, which cannot solve them.
6. Leave port 3478 out of it. Calls media is TURN over UDP and TCP, not HTTP. No HTTP edge can carry it.

The friendliest edge is a layer 4 passthrough: it preserves everything above by not touching it. Each layer 7 feature you add after that is something to test against the list.

## Cloudflare

:::caution
We do not recommend the Cloudflare proxy. Proxied mode means Cloudflare terminates your TLS. Every request is decrypted on their servers before it reaches you: every note, every message, every file, every credential. That is not a Cloudflare flaw. It is what an HTTP proxy is. It also puts a third party inside a product you chose to run on your own hardware. Turn it on only if you accept that Cloudflare can read everything your organization puts in Uniffy. DNS only mode avoids all of this and still gives you Cloudflare DNS.
:::

If you accept that tradeoff, the proxy works in front of Uniffy with the settings below. Anything not mentioned is fine at its default.

### DNS records

| Record | Mode | Why |
|---|---|---|
| `uniffy.example.com` | DNS only recommended | Proxied works for HTTP traffic, at the cost in the warning above. |
| `turn.example.com` | DNS only, always | TURN is not HTTP. Proxied mode makes the record resolve to Cloudflare, which will never answer a TURN allocation, and calls fail with a working app. |

The TURN record pointing at Cloudflare is the single most common way to break calls behind an edge. A DNS only record does reveal that address; if hiding your origin matters, give media its own IP rather than proxying it.

On the VM install the app and TURN share a hostname by default. Behind the Cloudflare proxy that stops working, so give media its own name:

```bash
sudo bash uniffy-k3s.sh install \
  --hostname uniffy.example.com \
  --turn-hostname turn.example.com \
  --acme-email admin@example.com
```

### TLS mode

Full (strict), nothing else. Uniffy's gateway terminates its own certificate, so strict verification costs nothing. Flexible mode sends plain HTTP to the origin and is not supported: secure cookies and the gateway's listeners both assume TLS.

### Switch off anything that edits HTML

Rocket Loader, email obfuscation, Zaraz, and any feature described as injecting or rewriting page content. Each one adds script the content security policy rejects, and the app breaks in ways that look like our bug. If the browser console shows CSP violations naming Cloudflare scripts, this is why.

### Keep challenges away from the API

Bot Fight Mode, managed challenges, and Under Attack mode must exclude `/api`. A browser might pass a challenge invisibly; the mobile app cannot pass one at all. If you want bot protection, scope it to `/` and leave the API to rate limits, which Uniffy applies per IP on its own.

WAF managed rules can stay on. Watch the WAF event log during the first week: RPC bodies carrying code snippets or markdown occasionally trip generic injection rules, and the fix is an exclusion for the matched rule on `/api`, not disabling the WAF.

### Limits that do not bite, and one that might

File uploads travel as chunks of at most 50 MB, safely under the 100 MB request body cap on Cloudflare's free plan. Caching defaults are safe: Cloudflare does not cache API responses unless you force it, so do not create a cache everything rule that covers `/api`. The one to remember is the 100 second first byte timeout: everything Uniffy streams sends bytes early, but if a custom automation of yours produces a single silent long call, that is where it will die.

## Client addresses behind an edge

Cloudflare terminates the connection, so the gateway sees Cloudflare's addresses. Two things depend on the real client address and both need telling:

- Set `TRUSTED_PROXY_HOPS=2`, one hop for Cloudflare and one for the gateway, so audit logs and per IP rate limits record the person, not the proxy. The row in [Configure Uniffy](/docs/deployment/configure/) explains the count.
- The operator API allowlist from [Harden the Edge](/docs/deployment/hardening/) evaluates the address the gateway sees. Behind Cloudflare, configure the gateway to trust one forwarded hop, and only after locking the origin down so traffic cannot reach it around Cloudflare; a forwarded header from an unlocked origin is an open door with extra steps. Belt and suspenders: mirror the same block as a Cloudflare WAF rule, path prefix `/api/superadmin.v1.` denied unless the source is your VPN.

A corporate edge that terminates TCP instead has the same problem with a different fix: enable proxy protocol on both the edge and the gateway, and the original address survives the hop.

## Other edges in one paragraph each

**A passthrough network load balancer** in front of the gateway needs nothing from this page. Client addresses, TLS, streams, and websockets all arrive intact. This is the recommended shape for a corporate edge.

**A terminating layer 7 edge** such as an ALB, F5, or HAProxy in HTTP mode gets measured against the six rules at the top: websockets on, buffering off, idle timeouts up, no body rewriting, no challenges, and the client address delivered by forwarded headers with the hop count set accordingly. The decryption fact from the Cloudflare warning applies here too. Whoever terminates TLS reads everything, though trusting your own appliance is a different decision than trusting a third party.

**A CDN other than Cloudflare** follows the Cloudflare section in spirit, warning included: the proxy reads your traffic, never proxy the TURN hostname, cache nothing under `/api`, and inject nothing.

The pattern across all of it: Uniffy assumes the pipe between the browser and the gateway is dumb. Every edge feature is a smartness added to that pipe, and each one is your responsibility to test. When something breaks only for users behind the edge, take the edge out of the path first and let the difference tell you which feature to go look at.
