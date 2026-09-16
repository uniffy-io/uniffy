---
title: Verify a Release
description: Every Uniffy release is signed. How to check the pinset, the images, and the SBOM before you trust them, by hand or with an admission policy in your cluster.
sidebar:
  label: Verify a Release
  order: 4
---

Every Uniffy release is signed, and this page is the check you run before you trust one. It takes one binary and one identity string. Nothing here needs a GitHub account, and all of it works against a private registry.

## What a release ships

A release on GitHub carries `images.txt`, the pinset. One line per image, `name@sha256:...`, both architectures behind one digest. Next to it sits `images.txt.sigstore.json`, the signature of that file, and one SBOM per image and architecture in SPDX JSON.

Each image digest in the pinset is signed, and carries its SBOMs as attestations. The signatures live in the registry next to the image and in the public Sigstore transparency log. GitHub records a build provenance attestation for the same digests.

All of it is produced by one thing: the release workflow in the `uniffy-io/uniffy` repository, running for a version tag, after the full test suite passed for that exact commit. That workflow is the identity you verify against.

## The identity

Signing is keyless. There is no key we could lose or leak. The certificate names the workflow that signed, and the transparency log records when. You check two values:

```
issuer:   https://token.actions.githubusercontent.com
identity: https://github.com/uniffy-io/uniffy/.github/workflows/release.yml@refs/tags/v<version>
```

Every command below uses the same pair. The identity is a regular expression so one policy covers every release:

```bash
export COSIGN_ISSUER=https://token.actions.githubusercontent.com
export COSIGN_IDENTITY='^https://github.com/uniffy-io/uniffy/\.github/workflows/release\.yml@refs/tags/v'
```

Get [cosign](https://github.com/sigstore/cosign) 3.0 or newer. Older versions cannot read the bundle format the signatures use.

## Verify the pinset

Start with the file, because everything else you pull comes from it:

```bash
cosign verify-blob images.txt --bundle images.txt.sigstore.json \
  --certificate-oidc-issuer "$COSIGN_ISSUER" \
  --certificate-identity-regexp "$COSIGN_IDENTITY"
```

A pass means the lines in your `images.txt` are the lines we published for that tag. Now every digest you use in a values file, a mirror script, or a manifest comes from a verified list.

## Verify an image

```bash
cosign verify ghcr.io/uniffy-io/uniffy@sha256:... \
  --certificate-oidc-issuer "$COSIGN_ISSUER" \
  --certificate-identity-regexp "$COSIGN_IDENTITY"
```

Same for `ghcr.io/uniffy-io/uniffy-frontend`. Verify the digest from the pinset, not a tag. A tag can move; a digest cannot, and the signature is over the digest.

## Read the SBOM

The SBOM is attested, which means it is signed and bound to the digest. Your scanner can trust it as the inventory of that image:

```bash
cosign verify-attestation --type spdxjson ghcr.io/uniffy-io/uniffy@sha256:... \
  --certificate-oidc-issuer "$COSIGN_ISSUER" \
  --certificate-identity-regexp "$COSIGN_IDENTITY" \
  | jq -r '.payload' | base64 -d | jq '.predicate' > uniffy.spdx.json
```

You get two attestations back, one for `linux/amd64` and one for `linux/arm64`. The `name` field inside each SPDX document says which. Feed the one that matches your nodes to `trivy sbom` or `grype`.

## With the GitHub CLI

If you have `gh` and access to the repository, one command covers the image and the pinset file:

```bash
gh attestation verify oci://ghcr.io/uniffy-io/uniffy:1.0.0 --owner uniffy-io
gh attestation verify images.txt --owner uniffy-io
```

It checks the same build provenance the release workflow recorded. Use whichever tool your team already has; both answer the same question.

## In the cluster

Checking by hand proves the release once. An admission policy proves every pod, every restart, forever. With [Kyverno](https://kyverno.io) 1.19 or newer, this policy refuses any image in the `uniffy` namespace that we did not sign from a release tag, and rewrites tags to the verified digest on the way in:

```yaml
apiVersion: policies.kyverno.io/v1
kind: ImageValidatingPolicy
metadata:
  name: uniffy-release-images
spec:
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: [v1]
        operations: [CREATE, UPDATE]
        resources: [pods]
  matchImageReferences:
    - glob: "ghcr.io/uniffy-io/*"
  mutateDigest: true
  attestors:
    - name: release
      cosign:
        keyless:
          identities:
            - issuer: https://token.actions.githubusercontent.com
              subjectRegExp: "^https://github.com/uniffy-io/uniffy/\\.github/workflows/release\\.yml@refs/tags/v.*"
  attestations:
    - name: sbom
      intoto:
        type: https://spdx.dev/Document
  validations:
    - expression: >-
        images.containers.map(image, verifyImageSignatures(image, [attestors.release])).all(e, e > 0)
      message: image is not signed by the Uniffy release workflow
    - expression: >-
        images.containers.map(image, verifyAttestationSignatures(image, attestations.sbom, [attestors.release])).all(e, e > 0)
      message: image carries no signed SBOM
```

Scope the namespace with a `matchConditions` entry if your cluster runs other workloads under the same glob. If you mirror into a private registry, change the glob to your registry path; the signatures travel with the images, and the identity stays the same.

## Private registries and isolated clusters

`mirror.sh` copies each image together with its signatures and attestations, so the same `cosign verify` works against `registry.internal/uniffy/uniffy@sha256:...` with no change beyond the name.

Verification needs the Sigstore trust root. On a machine with internet access, run `cosign initialize` once. It caches the root under `~/.sigstore`. Copy that directory to the isolated machine. The signature bundle carries its own transparency log entry, so verification then runs without a connection.

## What this proves, and what it does not

A valid signature proves the digest was built by our release workflow, from a tagged commit on our main branch, after every test passed for that commit. A stolen registry token cannot forge it. A tampered mirror cannot forge it. A laptop cannot forge it. Someone who moves the `1.4.0` tag to a different image gets a digest that fails your policy.

It does not prove the code is free of bugs, and it does not protect you from us being compromised. If someone took over our GitHub organization, they could push a tag and cut a signed release. What limits that is process on our side: branch protection, review, and the fact that every signing event is public in the transparency log, where we and anyone else can watch for a release we did not make.

Your side of that bargain is digests. Install from the pinset, pin the digests in your values, and an existing deployment never changes without you changing it. Upgrades are a decision you make with a new, verified `images.txt` in hand.

When you evaluate another vendor, ask them for the identity string. If they cannot hand you one line that lets you refuse every image they did not build, the signatures are decoration.
