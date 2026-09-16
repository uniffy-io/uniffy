---
title: Install on Kubernetes
description: Deploy Uniffy on your own Kubernetes cluster with the Helm chart. Prerequisites, the traffic plane contract, the decisions that are yours, and the ones that are not.
sidebar:
  label: Install on Kubernetes
  order: 2
---

This page is for a platform team putting Uniffy on a cluster they already run. It is a contract page as much as a procedure page: it says exactly what you bring, what the chart brings, and where the flexibility starts and stops. For one team on one machine, the [VM install](/docs/deployment/install-k3s/) is less work and the same product.

## What you bring, what we bring

| You bring | We bring |
|---|---|
| A conformant Kubernetes cluster, 1.30 or newer | The Uniffy Helm chart: app tier, routes, optional data stores |
| A storage class for persistent volumes | Pinned install commands for the platform components |
| LoadBalancer capability, cloud or MetalLB | A tested **pinset** per release |
| Two DNS records, app and TURN | A mirror script for private registries |
| S3 compatible object storage | |
| A TLS strategy: ACME, your CA, or an owned certificate | |
| Optional: an external Postgres 18 | |
| Optional: SMTP credentials | |

## Object storage is yours

The chart does not bundle object storage on this path. Bring any S3 compatible service: AWS S3, Cloudflare R2, Backblaze B2, MinIO, RustFS, your appliance. One bucket, an endpoint, and a key pair.

Every file upload and download flows through the Uniffy backend, which checks permissions on each request. Browsers never talk to the storage endpoint, so it needs no public exposure and no CORS configuration. Keep it on a private network, reachable from the backend and workers only. Durability and replication are your provider's job, and that is the point of making you bring one.

## The traffic plane is not negotiable

Uniffy's edge must speak HTTP/2 in cleartext to the backend, pass websockets, and carry streams with no timeout and no buffering. The chart ships that contract as Envoy Gateway route resources, and calls media relays through STUNner. Both are required. The single escape hatch: disable calls and STUNner becomes optional.

This does not mean replacing your ingress. Envoy Gateway claims only its own GatewayClass and coexists with whatever already runs on the cluster. Run it dedicated to Uniffy. If policy requires your corporate edge in front, put it in front as a TCP or TLS passthrough and let our gateway stay the last hop that speaks to Uniffy. And if a service mesh injects sidecars by default, exclude the uniffy namespace; a proxy inside the proxy contract helps nobody.

## Two load balancers, two DNS records

The VM path hides this; a cluster cannot.

- The HTTP gateway takes 80 and 443. DNS: `uniffy.example.com` to this LoadBalancer.
- The STUNner media gateway takes 3478 over UDP and TCP. DNS: `turn.example.com` to this LoadBalancer.

Point the TURN record at the HTTP LoadBalancer and you get the worst failure mode we know: the app works perfectly and calls silently do not. On EKS the media service needs an NLB, since the classic load balancer does not do UDP. On bare metal, MetalLB provides both addresses.

## Install the platform components

Versions below come from the pinset of chart 1.0.0. Newer is not better here; tested together is better.

```bash
helm upgrade --install envoy-gateway oci://docker.io/envoyproxy/gateway-helm \
  --version 1.8.2 -n envoy-gateway-system --create-namespace

helm upgrade --install stunner-operator oci://ghcr.io/l7mp/stunner-gateway-operator \
  --version 1.2.1 -n stunner-system --create-namespace \
  --set stunnerGatewayOperator.dataplane.mode=managed

helm upgrade --install cloudnative-pg oci://ghcr.io/cloudnative-pg/charts/cloudnative-pg \
  --version 0.26.0 -n cnpg-system --create-namespace

# only for tls.mode acme or issuer
helm upgrade --install cert-manager oci://quay.io/jetstack/charts/cert-manager \
  --version v1.19.1 -n cert-manager --create-namespace --set crds.enabled=true
```

Envoy Gateway owns the Gateway API CRDs; the STUNner operator is configured to skip them. CloudNativePG is needed only when the chart runs Postgres for you.

## The decisions

Four decisions. Everything else is a value with a sane default.

**Postgres.** Bundled by default: the chart creates a CloudNativePG cluster with three instances, and anything under `postgres.parameters` lands in `postgresql.conf`, so tuning needs no chart surgery. To bring your own instead, it must be PostgreSQL 18 with the `pg_trgm`, `uuid-ossp`, and `unaccent` extensions available, and enough connections. Each backend or worker pod holds up to 100; the budget formula is in [System Architecture](/docs/deployment/system-architecture/).

**Gateway.** The chart creates its own Gateway by default. If you already run Envoy Gateway with a shared Gateway, point the chart at it with a parent reference instead.

**TLS.** Three modes. `acme` lets cert-manager fetch and renew a certificate. `issuer` uses a cert-manager issuer you already run, for private CAs. `existing` points at a TLS secret you created from a certificate you own; in that mode cert-manager is not needed at all:

```bash
kubectl -n uniffy create secret tls uniffy-tls \
  --cert=fullchain.pem --key=private.key
```

The certificate must be the full chain. Leaf only files fail on phones and corporate networks.

**Sizing.** Defaults: three backend replicas, three of each worker fleet. Valkey and Meilisearch run as singletons and scale vertically; their ceilings and every other scaling lever are in [System Architecture](/docs/deployment/system-architecture/).

## Create the secret

One secret carries every credential. The chart derives all the cross wired forms from it, such as the LiveKit key file and the STUNner authentication config, so nothing needs to be kept in sync by hand.

```bash
kubectl create namespace uniffy
kubectl -n uniffy create secret generic uniffy-secret \
  --from-literal=JWT_SECRET_KEY="$(openssl rand -hex 32)" \
  --from-literal=APP_MASTER_KEY="$(openssl rand -base64 32)" \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=VALKEY_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=MEILISEARCH_MASTER_KEY="$(openssl rand -hex 24)" \
  --from-literal=LIVEKIT_API_SECRET="$(openssl rand -hex 32)" \
  --from-literal=TURN_SHARED_SECRET="$(openssl rand -hex 32)" \
  --from-literal=S3_ACCESS_KEY='your-storage-key' \
  --from-literal=S3_SECRET_KEY='your-storage-secret' \
  --from-literal=SMTP_PASSWORD='your-smtp-password' \
  --from-literal=INITIAL_ADMIN_PASSWORD='choose-one' \
  --from-literal=INITIAL_PLATFORM_ADMIN_PASSWORD='choose-one'
```

Back up `APP_MASTER_KEY` now, outside the cluster. It encrypts every secret your tenants store. Losing it loses that data permanently.

## Values and install

```yaml
# values.yaml
hostname: uniffy.example.com

turn:
  hostname: turn.example.com

tls:
  mode: existing
  existingSecret: uniffy-tls

gateway:
  create: true
  # parentRef: { name: shared-gateway, namespace: networking }

global:
  # labels:                     # stamped on every object the chart renders
  #   team: platform
  #   cost-center: collab
  # nodeSelector:               # every workload, unless the workload overrides
  #   kubernetes.io/arch: amd64
  # imageRegistry: registry.internal/uniffy
  # imagePullSecrets: [{ name: registry-credentials }]

backend:
  replicas: 3
  resources:                    # starting points, not gospel; measure and adjust
    requests: { cpu: "1", memory: 1Gi }
    limits: { memory: 2Gi }
  # podLabels: { tier: api }

workerCore:
  replicas: 3
  resources:
    requests: { cpu: 500m, memory: 768Mi }

workerEgress:
  replicas: 3
  # nodeSelector:               # overrides global for this workload only
  #   workload-class: burst

frontend:
  replicas: 2

livekit:
  # nodeSelector: { network: fast }
  # tolerations:
  #   - key: media-only
  #     operator: Exists

postgres:
  bundled: true                 # false to bring your own; fill external below
  instances: 3
  storageSize: 50Gi
  storageClass: fast-ssd
  parameters:                   # passed through to postgresql.conf
    max_connections: "1000"     # size with the connection budget formula
    shared_buffers: 2GB
  # external:
  #   host: pg.internal
  #   database: uniffy
  #   user: uniffy

config:                         # application settings, next section
  ALLOW_PUBLIC_REGISTRATION: "false"
  S3_ENDPOINT_URL: "https://storage.internal:9000"
  S3_BUCKET_NAME: "uniffy-files"
  S3_REGION: "us-east-1"
  SMTP_HOST: "smtp.internal"
  SMTP_PORT: "465"
  SMTP_USERNAME: "uniffy"
  MAIL_FROM_ADDRESS: "no-reply@example.com"
  INITIAL_ADMIN_EMAIL: "admin@example.com"

# configSecrets:                # extra Secrets attached as env, next section
#   - uniffy-extra-secrets
```

Every workload block (`backend`, `workerCore`, `workerEgress`, `frontend`, `livekit`, and `meilisearch`, `valkey`, `rustfs` when bundled) accepts the same scheduling keys: `replicas`, `resources`, `podLabels`, `podAnnotations`, `nodeSelector`, `tolerations`, and `affinity`. A key set on the workload wins over the same key under `global`; a key set nowhere is left to the scheduler. That covers the usual fleet policies without chart surgery: pin media to network optimized nodes, push the egress fleet onto burst capacity, keep cost labels on everything for the billing exporter.

```bash
helm upgrade --install uniffy oci://ghcr.io/uniffy-io/charts/uniffy \
  --version 1.0.0 -n uniffy -f values.yaml
```

## Application settings

Uniffy itself is configured through environment variables, and [Configure Uniffy](/docs/deployment/configure/) documents every one. The chart splits them into two groups.

**Chart owned.** Everything that wires the services the chart itself runs: the base URL and CORS origins derived from `hostname`, the connection settings for Postgres, Valkey, Meilisearch, LiveKit, and TURN, plus `WORKERS=1` and JSON logging. The chart renders these and a hand written value colliding with them fails the render loudly rather than silently losing. Your storage endpoint, your mail server, and the bootstrap identities are not plumbing the chart can know; they ride under `config:` like any other setting, with their secrets in `uniffy-secret`.

**Yours.** Everything that is policy rather than plumbing goes under `config:` in your values and lands in the app's environment as written. Secrets never go here: values files live in git, and a password in `config:` is a password in your history.

**Secret settings** ride in Secrets instead. The credentials the chart knows about live in `uniffy-secret`. For anything sensitive beyond that list, create your own Secret and name it under `configSecrets:`; the chart attaches every listed Secret to the backend and both worker fleets as environment, exactly like `config:` but out of the values file:

```yaml
configSecrets:
  - uniffy-extra-secrets
```

```bash
kubectl -n uniffy create secret generic uniffy-extra-secrets \
  --from-literal=SOME_SENSITIVE_SETTING='...'
```

Sources apply in order and later wins: `config:`, then `uniffy-secret`, then `configSecrets` entries in list order. That precedence is what makes an external secret manager clean: point ExternalSecrets, a Vault agent, or SOPS at materializing the Secret, list its name, and a key there overrides the same key anywhere earlier, rotation included.

Changing `config:` and running `helm upgrade` restarts the affected pods on its own; the pods carry a checksum of their configuration, so a config change is a rollout, not a mystery about which pod read what. The checksum only covers what the chart renders: when an external manager rotates a `configSecrets` Secret behind the chart's back, follow with `kubectl -n uniffy rollout restart deploy`, or let your secret operator's own reload annotation handle it. The same `config:` block works in `/etc/uniffy/values.yaml` on the VM path.

Three blocks cover most real deployments.

Bootstrap policy for a company install. Invitation only registration, a named organization, a clean workspace without the starter notes, and the operator role split from the daily admin account:

```yaml
config:
  ALLOW_PUBLIC_REGISTRATION: "false"
  DEFAULT_ORG_NAME: "Acme"
  SEED_STARTER_CONTENT: "false"
  INITIAL_PLATFORM_ADMIN_EMAIL: "platform@acme.com"
```

Leave `INITIAL_PLATFORM_ADMIN_EMAIL` unset and the initial admin is one combined account, which is the right shape for a small single org install. Set it and the platform operator becomes a separate login with its own password from the secret. [Admins and Operators](/docs/deployment/admins-and-operators/) covers which shape fits which deployment.

Behind an edge that terminates connections, tell the audit log and the rate limiter how many hops to look through, as covered in [Behind an Edge](/docs/deployment/edges/):

```yaml
config:
  TRUSTED_PROXY_HOPS: "2"    # Cloudflare plus the gateway
```

Tuning for how your organization actually uses Uniffy. Agent heavy teams raise the egress fleet's concurrency, orgs with huge channels lift the typing indicator cutoff, compliance teams turn on the per upload audit row:

```yaml
config:
  EGRESS_WORKER_MAX_JOBS: "80"
  CHAT_TYPING_MEMBER_LIMIT: "100"
  AUDIT_EVENTS_FILE_UPLOADED: "true"
```

One family deserves respect before you touch it: `DB_POOL_SIZE` and `DB_MAX_OVERFLOW` multiply across every backend and worker pod into your Postgres connection budget. The formula and the defaults are in [System Architecture](/docs/deployment/system-architecture/); raise replicas or pool sizes with the formula open, not from memory.

## Verify

```bash
kubectl -n uniffy get pods
curl -f https://uniffy.example.com/healthz
helm test uniffy -n uniffy
```

The chart's test suite checks the pieces that fail quietly: the h2c path to the backend, the websocket route, and a TURN allocation against `turn.example.com:3478` with a minted credential. Green tests mean chat streams and calls media both actually flow. Then sign in with the initial admin credentials and change the password.

Before any of this, [verify the release](/docs/deployment/verify/). The pinset file and every image in it are signed; ten seconds with cosign tells you the digests you are about to run are the ones we published.

## Day two

- [Upgrades](/docs/deployment/upgrades/): pinsets, the maintenance window, and why the Postgres dump comes first.
- [Backups and Restore](/docs/deployment/backups/): two things are non negotiable, Postgres and `APP_MASTER_KEY`. Turn on the continuous S3 backups the same day you install; the page has the four values it takes.
- Monitoring: the chart ships ServiceMonitors for the backend and both worker fleets, so metrics flow into whatever Prometheus stack the cluster runs.
- [Harden the Edge](/docs/deployment/hardening/): one chart value keeps the operator API off the internet. Do it the same week.

## Private registries and isolated clusters

Each release ships `images.txt`, the full image list with digests, and `mirror.sh`, which copies all of them into your registry, signatures and attestations included:

```bash
./mirror.sh registry.internal/uniffy
```

Then set one value:

```yaml
global:
  imageRegistry: registry.internal/uniffy
```

Charts install from local files the same way, so a cluster with no internet path runs the same pinset as everyone else. [Verify a Release](/docs/deployment/verify/) covers checking the signatures against your own registry, with or without a connection.

The short version of this page: you own the endpoints, we own the traffic plane. Postgres, storage, mail, and certificates plug in wherever yours live. The path a request takes between the user and Uniffy is ours, because that is the part that breaks in ways only we can test.
