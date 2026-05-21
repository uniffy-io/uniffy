# Encryption

[[[toc|min=1|max=4|style=flat|bullets=none]]]

Uniffy encrypts the most sensitive values it stores -- AI provider keys today, mail credentials and signing secrets in future releases -- before they ever reach the database. A database dump on its own is not enough to read them; a second key, held outside the database, is required to decrypt anything.

## What is Protected

Every connection between the browser, the mobile app, and the server runs over TLS. The Postgres database, the object store that holds uploaded files, and the search index sit on disks encrypted by the cloud provider in the hosted product, or by the operator's chosen volume in self-hosted installs.

On top of that, Uniffy adds an application-level layer for values that would still be sensitive to someone with full database access. The bodies of notes, files, calendar events, projects, and chat messages are not encrypted at the application layer -- they rely on the storage layer for at-rest protection. Application-level encryption is reserved for credentials and signing secrets where a database leak alone would let an attacker act on an organization's behalf elsewhere.

## How Encryption Works

Uniffy uses envelope encryption with two keys.

The first is a deployment-wide **master key**, loaded from the `APP_MASTER_KEY` environment variable. It never goes into the database.

The second is a per-organization **data encryption key**, generated automatically the moment an organization is created. The data key is what actually encrypts the secret. The data key itself is stored in the database, but only after the master key has wrapped (encrypted) it. To read a protected value, Uniffy first unwraps the data key with the master key, then uses the data key to decrypt the row.

Both keys must be present. The database alone is not enough; the master key alone is not enough.

Because each organization has its own data key, the blast radius of a compromise is limited to one tenant. Rotating one organization's key does not touch any other organization's data.

The cryptography is AES-128-CBC for confidentiality plus HMAC-SHA256 for integrity, as defined by the [Fernet](https://cryptography.io/en/latest/fernet/) specification. Tampered ciphertexts fail to decrypt rather than returning garbage.

## Who Holds the Master Key

The master key is the single most important secret in a Uniffy deployment, and who carries the responsibility for it depends on where Uniffy is running.

**Uniffy Cloud.** We hold the master key. It lives in our secrets management platform, separate from the database, with audited access restricted to a small on-call group. We rotate it on the schedule documented in our security overview, and we handle the operational story end-to-end. Customers do not configure or touch the key.

**Self-hosted.** The administrator who runs the deployment is responsible. That means generating the key, putting it in a secrets manager the rest of the company cannot read, and keeping it strictly separate from database access. Anyone who can read both the database and the master key can decrypt every protected secret in the deployment, so the two should never sit in the same vault, the same backup target, or under the same set of credentials. A typical setup keeps the database accessible to the operations team and the master key accessible to a smaller security or compliance group, so neither group alone can read tenant secrets.

For self-hosted setups the key is a 44-character Fernet key, generated once with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and supplied to every Uniffy process through the `APP_MASTER_KEY` environment variable. The application refuses to start without it.

## Rotating an Organization's Key

Rotation generates a fresh data key for one organization, re-encrypts every protected secret under the new key, and retires the old one. Use it when a tenant suspects a credential leak, when someone with database access leaves the team, or as a periodic hygiene step.

Only the organization OWNER can trigger rotation. Domain admins and regular admins cannot, on purpose, so the action requires the same level of accountability as transferring ownership.

While the rotation runs, existing requests continue to work. The old data key stays in the database long enough for in-flight reads to finish, and Uniffy notifies every running server that the active key has changed so cached copies of the old key are dropped. The re-encryption of stored rows happens in the background and is safe to retry if it is interrupted -- partial progress never leaves secrets unreadable.

## If the Master Key is Lost

Losing the master key is unrecoverable. Every protected secret in the deployment becomes permanently unreadable. The database rows still exist, but Uniffy cannot turn them back into plaintext, and there is no support process that can. Affected secrets (AI provider keys, mail credentials) must be re-entered by users.

Notes, files, calendar events, projects, and chat remain readable because they are protected by the storage layer rather than by the master key. The damage from a lost master key is bounded to the credentials category, but it is unrecoverable within that category.

A wrong master key -- a typo, a swapped staging-vs-production environment variable -- produces the same symptom at startup: the application refuses to decrypt anything. Restoring the correct key brings everything back. The unrecoverable case is *losing the original*, not setting the wrong one temporarily.

If the master key is compromised but the database is still safe, an attacker has nothing to decrypt. The recommended response is to rotate the master key at the next maintenance window. If both the master key and the database are compromised at the same time, treat it as a full breach for the credentials category: rotate every organization's data key and rotate the underlying external credentials (AI providers, mail accounts) outside Uniffy.

## Frequently Asked Questions

**Are my notes and files encrypted?** At the storage layer, yes, on any platform where the disk is encrypted. Uniffy does not add application-level encryption on the body of notes or the bytes of files. Application-level encryption is applied to credentials and signing secrets where a database leak alone would let an attacker act on the organization's behalf.

**Can an administrator read another user's AI provider key?** No. The product never exposes the decrypted value through any screen or API. Uniffy uses the key internally when calling the provider on the user's behalf and discards the plaintext from memory afterwards.

**Can I bring my own key, hosted in my KMS?** Not yet for self-hosted. A future release plans to support cloud KMS integrations (AWS KMS, GCP KMS, Azure Key Vault, HashiCorp Vault) so the master key never leaves the KMS even in memory.

**Does rotation take the workspace offline?** No. Existing requests continue to work while the rotation sweep runs in the background. For most organizations rotation completes in under a second because the number of rows to rewrite is small.

**Is the master key the same as the JWT signing key?** No. They are different secrets with different lifecycles. Rotating the JWT signing key invalidates user sessions; rotating the master key is a data-at-rest operation. Coupling them would mean one incident forces the other, so Uniffy keeps them separate by design.

**How can I verify that a value is actually encrypted in the database?** Open the database and inspect a row in `agents_provider_keys`. The `encrypted_credential` column shows a string starting with `v1:` followed by an opaque base64 blob. That blob can only be decoded with both the wrapped data key from `org_encryption_keys` and the master key.
