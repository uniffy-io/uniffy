---
title: Harden the Edge
description: Lock the platform operator API to your private network with one chart value. What it blocks, what it renders, how to verify it, and when the client IP lies.
sidebar:
  label: Harden the Edge
  order: 7
---

This page is for someone running Uniffy themselves who wants the operator surface unreachable from the internet. One value in your chart configuration gets you there.

## What you are blocking

Every platform operator RPC lives under one path prefix: `/api/superadmin.v1.`. Cross tenant organization and user administration, operator support session requests, the platform audit feed, system mail, system encryption, system configuration, and operator two factor resets all sit behind it. Nothing tenant facing does.

That makes the rule short and complete. Block `/api/superadmin.v1.` from public sources and the operator API is gone from the internet, while every org admin surface keeps working. The single highest value RPC behind the rule is `SetSystemAdmin`, which grants platform operator rights to a user account.

Tenant consent for support sessions is deliberately outside the prefix, on `/api/support.v1.SupportConsentService`. Org admins approve, reject, and revoke operator access from their admin pages, so that path must stay publicly reachable. Blocking the superadmin prefix does not touch it.

## The one value

```yaml
operatorApi:
  allowedCIDRs:
    - 10.0.0.0/8        # your private range or VPN subnet
```

On a cluster, add it to your values and run the same `helm upgrade` you installed with. On the VM, add it to `/etc/uniffy/values.yaml` and run `sudo uniffy-k3s upgrade`, which reapplies your values even when you are already on the newest release.

Unset, the operator API is reachable from anywhere, which is the correct default for a first install where the operator has not built a VPN yet. Set it the same week you go live.

## What it renders

The chart's HTTPRoute carries a named rule for the operator prefix. When `allowedCIDRs` is set, the chart attaches an Envoy Gateway SecurityPolicy to exactly that rule:

```yaml
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata:
  name: uniffy-operator-api
  namespace: uniffy
spec:
  targetRefs:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      name: uniffy
      sectionName: operator-api
  authorization:
    defaultAction: Deny
    rules:
      - action: Allow
        principal:
          clientCIDRs:
            - 10.0.0.0/8
```

Requests to the operator prefix from outside the list get a 403 at the gateway and never reach the backend. Requests from inside the list flow through the normal path. Every other route is untouched.

## Verify it

From a machine outside the allowed range:

```bash
curl -i -X POST https://uniffy.example.com/api/superadmin.v1.SystemAdminService/ListOrganizations
# expect: HTTP/2 403
```

From inside the range, the same request returns an authentication error from the backend instead of a 403 from the gateway. That difference is the proof: outside dies at the edge, inside reaches the app and still needs operator credentials. Run both, not just one.

## The client IP is only as real as your topology

The allow decision runs against the client address the gateway sees. When the gateway's LoadBalancer faces clients directly, that is the real peer address and the rule means what it says.

Put anything in front and you owe it a thought. A passthrough load balancer that preserves source addresses changes nothing. An edge that terminates TCP replaces every client with its own address, and the allowlist collapses into all or nothing: enable proxy protocol on both the edge and the gateway so the original address survives the hop. If your edge speaks HTTP and forwards with `X-Forwarded-For` headers instead, the gateway must be told how many hops to trust before the rule can use that header. Get this wrong in the permissive direction and the rule allows everyone; get it wrong in the strict direction and it blocks your own VPN. Test from both sides after any edge change.

Inside the app, `TRUSTED_PROXY_HOPS` controls which forwarded address Uniffy records in the audit log and uses for per IP rate limits. It is a hop count, not a trust list, and it does not participate in the gateway rule at all. The row in [Configure Uniffy](/docs/deployment/configure/) has the full behavior. For the Cloudflare and corporate edge specifics, see [Behind an Edge](/docs/deployment/edges/).

## Blocking the platform pages is cosmetic

The `/platform` routes in the browser app are client side. An edge block on them stops cold deep links and nothing else, because the JavaScript bundle routes without asking the server. The API rule above is the actual control. Add a `/platform` block if you like tidy 403s, but do not mistake it for the security boundary.

## Keep metrics private too

The backend serves an unauthenticated Prometheus endpoint at `/metrics`. The chart never routes it through the gateway; scraping happens inside the cluster through the shipped ServiceMonitors. Keep it that way. If you add custom routes, `/metrics` does not belong on the public listener.

## See also

- [Configure Uniffy](/docs/deployment/configure/)
- [System Architecture](/docs/deployment/system-architecture/)
