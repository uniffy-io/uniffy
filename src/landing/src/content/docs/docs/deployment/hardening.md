---
title: Harden the Edge
description: Lock the platform operator API to your private network with one reverse proxy rule. Caddy and nginx examples, client IP configuration, and what not to expose.
sidebar:
  label: Harden the Edge
  order: 5
---

This page is for someone running Uniffy themselves who wants the operator surface unreachable from the internet. One reverse proxy rule gets you there.

## What you are blocking

Every platform operator RPC lives under one path prefix: `/api/superadmin.v1.`. Cross tenant organization and user administration, operator support session requests, the platform audit feed, system mail, system encryption, system configuration, and operator two factor resets all sit behind it. Nothing tenant facing does.

That makes the deny rule short and complete. Block `/api/superadmin.v1.` from public sources and the operator API is gone from the internet, while every org admin surface keeps working. The single highest value RPC behind the rule is `SetSystemAdmin`, which grants platform operator rights to a user account.

Tenant consent for support sessions is deliberately outside the prefix, on `/api/support.v1.SupportConsentService`. Org admins approve, reject, and revoke operator access from their admin pages, so that path must stay publicly reachable. Blocking the superadmin prefix does not touch it.

## Caddy

The shipped `.docker/prod/Caddyfile` proxies `/api/*` to the backend and everything else to the frontend. Add the operator matcher above the general `/api` handler and replace the network with whatever private range or VPN subnet your admin machines use.

```text
uniffy.example.com {
	@operator {
		path /api/superadmin.v1.*
		not remote_ip 10.0.0.0/8
	}
	handle @operator {
		respond 403
	}

	handle /api/* {
		reverse_proxy backend:8000
	}

	handle /healthz {
		reverse_proxy backend:8000
	}

	handle {
		reverse_proxy ui:80
	}
}
```

Caddy evaluates `handle` blocks in order, so the 403 wins for operator paths from outside the allowed range. Requests from inside the range fall through to the normal `/api` proxy.

## nginx

The `^~` prefix modifier makes this location win over the general `/api/` location. Mirror the same proxy headers in both, or the blocked path and the open path will disagree about the client IP.

Set `proxy_http_version 1.1` in both locations. Browsers speak HTTP/2 to nginx, but nginx talks to an upstream over HTTP/1.x, and its default is 1.0. HTTP/1.0 has no chunked transfer encoding, which the streaming parts of Uniffy need. Leave it at the default and chat, notifications, and agent replies stop arriving while ordinary requests keep working.

```nginx
location ^~ /api/superadmin.v1. {
    allow 10.0.0.0/8;
    deny all;

    proxy_pass http://backend:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://backend:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

`proxy_buffering off` on the general location keeps streamed responses flowing instead of collecting in nginx until the handler finishes.

## The client IP is only as real as your topology

The allow and deny decision above runs on the proxy, against the TCP peer address the proxy sees. That is only meaningful when the proxy is the single way to reach the backend port. If the backend is also reachable directly, the rule protects one door of a building with two doors. Bind the backend to a private interface or firewall its port so all traffic goes through the proxy.

Inside the app, `TRUSTED_PROXY_HOPS` controls which `X-Forwarded-For` entry Uniffy records in the audit log and uses for per IP rate limits. It is a hop count, not a list of trusted addresses. Set it to `1` behind a single proxy, `2` behind a chained pair. It does not participate in the deny rule at all, and setting it does not make a forged header safe: any client that can reach the backend without passing through your proxy can write whatever it likes into `X-Forwarded-For`. The row in [Configure Uniffy](/docs/deployment/configure/) has the full behavior.

## Blocking the platform pages is cosmetic

The `/platform` routes in the browser app are client side. An edge block on them stops cold deep links and nothing else, because the JavaScript bundle routes without asking the server. The API rule above is the actual control. Add a `/platform` block if you like tidy 403s, but do not mistake it for the security boundary.

## Keep metrics private too

The backend serves an unauthenticated Prometheus endpoint at `/metrics`. The shipped Caddy config never routes it, which is the correct default. If you write your own proxy config, keep `/metrics` off the public listener entirely or give it the same private network treatment as the operator API.

## See also

- [Configure Uniffy](/docs/deployment/configure/)
- [Architecture](/docs/deployment/architecture/)
