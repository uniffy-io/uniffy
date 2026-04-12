# Permissions System - Integration Test Proposal

> Status: proposal, pending approval
> Related: `docs/specs/permissions-redesign.md` (authoritative design), `docs/specs/permissions-redesign-backlog.md` (progress tracker)

This document proposes end-to-end integration tests for the permissions system. The tests exercise the full API stack - HTTP request through ConnectRPC dispatcher, JWT auth extraction, handler logic, operations layer, real SQL against PostgreSQL, proto serialization - not just the Python branching logic.

---

## Why

The existing unit tests in `src/uniffy/tests/core/` mock every DB call. They validate branching logic but never exercise:

1. **The HTTP layer** - ConnectRPC serialization, `ConnectRPCDispatcher` routing, `LoggingInterceptor`
2. **Auth extraction** - `get_user_id_from_context` / `get_organization_id_from_context` from real JWT headers
3. **Handler error mapping** - `PermissionDeniedError` to `Code.PERMISSION_DENIED`, `NotFoundError` to `Code.NOT_FOUND`
4. **Proto field correctness** - `access_mode`, `baseline_role`, `user_role` on every response message
5. **Real SQL** - `build_accessible_filter` producing valid WHERE clauses, group joins, expiration filtering
6. **Transaction atomics** - audit event + mutation committed together, rollback on failure
7. **Cross-domain delegation** - task access resolved through parent project via real FK joins
8. **Unique constraints** - ContentMember 5-tuple uniqueness enforced by Postgres

---

## Architecture

```
httpx.AsyncClient (in-process ASGI transport, no network)
  |
  +-> ConnectRPCDispatcher (real factory.py dispatcher)
       |
       +-> LoggingInterceptor
            |
            +-> MembersServiceImpl / NotesServiceImpl / etc.
                 |
                 +-> get_user_id_from_context (real JWT decode)
                 +-> open_session() (real AsyncSession)
                 +-> Operations layer (real SQL against PostgreSQL)
                 +-> Proto response (real serialization)
```

No network hop. `httpx.AsyncClient` speaks ASGI directly to the app. The only real external dependency is PostgreSQL (already in docker-compose).

### What is real vs stubbed

| Component | Real or Stub |
|-----------|-------------|
| PostgreSQL | **Real** (docker-compose, `uniffy_test` DB) |
| Alembic migrations | **Real** (run once per session) |
| JWT token creation/decode | **Real** (`create_access_token` + `decode_access_token`) |
| ConnectRPC dispatcher | **Real** (`ConnectRPCDispatcher` from factory) |
| Service handlers | **Real** (all handlers, interceptors) |
| Operations layer | **Real** (all business logic) |
| PermissionChecker | **Real** (all SQL queries) |
| Meilisearch/SearchIndexer | **Stub** (mock `index`/`update_sharing`/`delete`) |
| S3/RustFS | **Stub** (not used by permissions) |
| Valkey/job queue | **Stub** (not used by permissions) |
| Notification emitter | **Stub** (mock, verify calls) |

### How ConnectRPC requests work

ConnectRPC uses plain HTTP POST with JSON bodies. No special client library needed:

```python
response = await client.post(
    "/api/permissions.v1.MembersService/AddMember",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    },
    content=AddMemberRequest(
        organization_id=str(org_id),
        content_type=ContentType.CONTENT_TYPE_NOTE,
        content_id=str(note_id),
        subject_type=SubjectType.SUBJECT_TYPE_USER,
        subject_id=str(target_user_id),
        role=ContentRole.CONTENT_ROLE_EDITOR,
    ).to_json(),
)
assert response.status_code == 200
member = MemberResponse().from_json(response.content)
```

Errors come back as JSON with a `code` field matching ConnectRPC error codes.

---

## Infrastructure

### Database

No new services. Reuse postgres from `docker-compose.yml` (already running for dev). Create a separate database `uniffy_test` so dev data is never touched.

```
docker-compose.yml postgres (already running)
  |
  +-- uniffy         (dev database, untouched)
  +-- uniffy_test    (test database, created/dropped per session)
```

### Dependencies to add

```toml
# pyproject.toml [dependency-groups] dev
"pytest-asyncio>=0.24.0",
"httpx>=0.28.0",
```

### New command in run.sh

```bash
run_test_integration() {
  POSTGRES_DB=uniffy_test JWT_SECRET_KEY=test-secret-key \
    uv run pytest src/uniffy/tests/integration/ -x -v
}
```

### How to run

```bash
# Ensure postgres is running
docker compose up -d postgres

# Run integration tests
./run.sh test-integration

# Run a specific file
POSTGRES_DB=uniffy_test JWT_SECRET_KEY=test-secret-key \
  uv run pytest src/uniffy/tests/integration/test_members_api.py -x -v
```

---

## Fixture design

Location: `src/uniffy/tests/integration/conftest.py`

| Fixture | Scope | What it does |
|---------|-------|-------------|
| `test_db` | session | Creates `uniffy_test` DB, runs all migrations, yields engine, drops DB after |
| `db_session` | function | Opens transaction, yields `AsyncSession`, rolls back after each test (fast isolation) |
| `app` | session | Builds ASGI app via `_create_api_dispatcher()` with real services, mocked Meilisearch/S3/Valkey |
| `client` | function | `httpx.AsyncClient(transport=ASGITransport(app))` |
| `org` | function | Inserts `Organization` + `OrganizationPermissionDefaults` rows |
| `make_user` | function | Factory: creates `User` + `OrganizationMember`, returns `(user_id, jwt_token)` |
| `make_group` | function | Factory: creates `Group` + `GroupMember` rows |
| `make_note` | function | Factory: creates `Note` with given `access_mode`/`baseline_role`/`owner_id` |
| `make_project` | function | Factory: creates `Project`, optionally with tasks |
| `make_member` | function | Factory: inserts `ContentMember` row directly (for setup, not testing the API) |

The transaction-rollback pattern means each test starts clean without needing to recreate tables. Migrations run once per session. `db_session` patches `open_session` and `get_async_session` to return the test session so every handler call goes through the same session that the fixture controls.

---

## Test file layout

```
src/uniffy/tests/integration/
  conftest.py                  # DB fixtures, ASGI app, factories
  test_members_api.py          # MembersService RPCs end-to-end
  test_notes_api.py            # NotesService permission enforcement
  test_projects_api.py         # Projects + task delegation
  test_access_filtering.py     # List endpoints respect access rules
  test_audit_log.py            # ListMemberEvents through the API
  test_error_codes.py          # Correct ConnectRPC error codes for all denial paths
```

---

## Test coverage per file

### `test_members_api.py` (~30 tests)

The `permissions.v1.MembersService` RPCs end-to-end.

| Test | Sends | Expects |
|------|-------|---------|
| AddMember happy path | `AddMember(role=EDITOR)` as content ADMIN | 200, member with EDITOR role |
| AddMember as VIEWER (no manage) | `AddMember` as VIEWER | `PERMISSION_DENIED` |
| AddMember with OWNER role | `AddMember(role=OWNER)` | `INVALID_ARGUMENT` |
| AddMember on OWNER_ONLY content | `AddMember` on owner-only note | `INVALID_ARGUMENT` |
| AddMember targeting the owner | `AddMember(subject=owner)` | `INVALID_ARGUMENT` |
| AddMember BLOCKED on org admin | `AddMember(role=BLOCKED, subject=orgAdmin)` | `INVALID_ARGUMENT` |
| AddMember upsert (existing member) | `AddMember` twice with different role | 200, role updated |
| UpdateMemberRole happy path | `UpdateMemberRole(new_role=ADMIN)` | 200, role changed |
| UpdateMemberRole to OWNER | `UpdateMemberRole(new_role=OWNER)` | `INVALID_ARGUMENT` |
| UpdateMemberRole idempotent | Same role twice | 200, no new audit event |
| RemoveMember happy path | `RemoveMember` | 200, success=true |
| RemoveMember non-existent | `RemoveMember` on unknown subject | `NOT_FOUND` |
| ListMembers returns all | Create 3 members, `ListMembers` | 200, 3 members ordered by added_at |
| ListMembers requires VIEW | `ListMembers` as unauthenticated user on EXPLICIT_MEMBERS | `PERMISSION_DENIED` |
| SetAccessMode to OPEN_TO_ORG | `SetAccessMode(OPEN_TO_ORG, VIEWER)` | 200, policy updated |
| SetAccessMode OPEN_TO_ORG without baseline | `SetAccessMode(OPEN_TO_ORG, null)` | `INVALID_ARGUMENT` |
| SetAccessMode to OWNER_ONLY with members, no flag | `SetAccessMode(OWNER_ONLY)` | `INVALID_ARGUMENT` |
| SetAccessMode to OWNER_ONLY with remove flag | `SetAccessMode(OWNER_ONLY, remove_members_on_narrow=true)` | 200, members deleted |
| TransferOwnership happy path | `TransferOwnership(new_owner)` as owner | 200, new owner_id |
| TransferOwnership ex-owner becomes ADMIN | After transfer, `ListMembers` | Ex-owner has ADMIN member row |
| TransferOwnership new owner's member row deleted | New owner had EDITOR row, after transfer it's gone | ListMembers confirms |
| TransferOwnership to non-org-member | `TransferOwnership(outsider)` | `INVALID_ARGUMENT` |
| TransferOwnership as non-owner | `TransferOwnership` as EDITOR | `PERMISSION_DENIED` |
| Org admin can manage any content | `AddMember` as org ADMIN on someone else's note | 200 |
| Domain admin can manage domain content | Notes domain admin can `AddMember` on any note | 200 |

### `test_notes_api.py` (~15 tests)

Permission enforcement through NotesService.

| Test | What it proves |
|------|---------------|
| Create note gets org default access_mode | Response has correct `access_mode`/`baseline_role` from org defaults |
| GetNote as owner | 200, note returned with `user_role=OWNER` |
| GetNote as explicit EDITOR | 200, `user_role=EDITOR` |
| GetNote as org member on OPEN_TO_ORG/VIEWER | 200, `user_role=VIEWER` |
| GetNote as BLOCKED user | `PERMISSION_DENIED` |
| GetNote on OWNER_ONLY as non-owner | `NOT_FOUND` (or `PERMISSION_DENIED`) |
| UpdateNote requires EDITOR | VIEWER gets `PERMISSION_DENIED`, EDITOR gets 200 |
| DeleteNote requires ADMIN | EDITOR gets `PERMISSION_DENIED`, ADMIN gets 200 |
| Org admin can access BLOCKED content | Org admin GETs note they're BLOCKED on = 200 |
| GetNote with expired member grant | Expired EDITOR = denied on EXPLICIT_MEMBERS content |
| GetNote via group membership | User in group with EDITOR grant can edit |
| GetNote group BLOCKED overrides direct EDITOR | BLOCKED from group wins |

### `test_projects_api.py` (~10 tests)

Task delegation to parent project.

| Test | What it proves |
|------|---------------|
| List tasks on OPEN_TO_ORG project | Org member sees tasks |
| List tasks on EXPLICIT_MEMBERS project | Non-member gets empty list |
| Get task delegates to parent project | Task access = project access |
| Create task requires EDITOR on project | VIEWER can't create task |
| BLOCKED on project = can't see tasks | BLOCKED user gets denied on task endpoints |
| Project owner can manage tasks | Owner can CRUD all tasks |
| Org admin sees tasks on OWNER_ONLY project | Admin bypass works through delegation |

### `test_access_filtering.py` (~12 tests)

List endpoints return correct content sets. Creates a matrix of notes/projects with different access modes and member configurations, then lists as different users.

| Test | Setup | List as | Expected |
|------|-------|---------|----------|
| Owned content always visible | Note owned by A, OWNER_ONLY | A | Note in list |
| OWNER_ONLY hides from others | Note owned by A, OWNER_ONLY | B (org member) | Not in list |
| Explicit member sees content | Note EXPLICIT_MEMBERS, B is EDITOR | B | In list |
| Non-member excluded | Note EXPLICIT_MEMBERS, no grant for C | C | Not in list |
| OPEN_TO_ORG visible to all org members | Note OPEN_TO_ORG/VIEWER | Any org member | In list |
| BLOCKED excluded from list | Note OPEN_TO_ORG, B is BLOCKED | B | Not in list |
| BLOCKED via group excluded | Note OPEN_TO_ORG, group G is BLOCKED, B in G | B | Not in list |
| Cross-org isolation | Note in org1, user in org2 | User from org2 | Not in list |
| Org admin sees everything | OWNER_ONLY note owned by A | Org admin | In list |
| Domain admin sees domain content | OWNER_ONLY note | Notes domain admin | In list |
| Mixed access modes correct count | 5 notes, various modes | Regular user | Correct subset |

### `test_audit_log.py` (~8 tests)

`ListMemberEvents` through the API.

| Test | What it proves |
|------|---------------|
| Add member produces MEMBER_ADDED event | Event has correct subject, new_role, actor |
| Role change produces MEMBER_ROLE_CHANGED event | previous_role and new_role both set |
| Remove produces MEMBER_REMOVED event | previous_role set, new_role null |
| SetAccessMode produces ACCESS_MODE_CHANGED event | previous/new access_mode fields |
| TransferOwnership produces two events | OWNERSHIP_TRANSFERRED + MEMBER_ADDED for ex-owner |
| Events ordered by occurred_at DESC | Most recent first |
| Filter by actor_user_id | Only events by that actor |
| Filter by action type | Only MEMBER_ADDED events |
| actor_org_role snapshot preserved | Event shows MEMBER even if actor is now ADMIN |

### `test_error_codes.py` (~10 tests)

Correct ConnectRPC error codes for all denial paths.

| Test | Action | Expected code |
|------|--------|--------------|
| No auth header | Any RPC without Authorization | `UNAUTHENTICATED` |
| Invalid JWT | Malformed token | `UNAUTHENTICATED` |
| Expired JWT | Token with past expiry | `UNAUTHENTICATED` |
| No access to content | GetNote on private note | `NOT_FOUND` |
| Insufficient role | UpdateNote as VIEWER | `PERMISSION_DENIED` |
| Invalid UUID in request | `content_id="not-a-uuid"` | `INVALID_ARGUMENT` |
| Content not found | GetNote with random UUID | `NOT_FOUND` |
| Validation failure | `SetAccessMode(OPEN_TO_ORG, baseline=null)` | `INVALID_ARGUMENT` |
| Org member required | Token without org_id | `PERMISSION_DENIED` or `UNAUTHENTICATED` |

---

## Total test count

~85 test functions across 6 files.

---

## Implementation order

1. **conftest.py** - DB lifecycle, session patching, ASGI app, factories
2. **test_members_api.py** - The core; exercises every `MembersService` RPC
3. **test_error_codes.py** - Quick wins, validates the error mapping layer
4. **test_notes_api.py** - Proves domain-level permission enforcement
5. **test_access_filtering.py** - Proves list queries work with real SQL
6. **test_projects_api.py** - Proves delegation pattern
7. **test_audit_log.py** - Proves audit trail integrity

---

## What stays as unit tests

The existing mock-based tests in `tests/core/` stay. They are fast (~0.5s total), test branching logic, and run without infrastructure. Integration tests complement them by proving the SQL is correct and the full API stack wires together properly.
