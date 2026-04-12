# Permissions Redesign -- Manual UI Test Plan

> Use this document after Phase 2 (frontend) and Phase 3 (end-to-end) are complete.
> Work through the plan in order. Each section builds on the previous one.
> Every step that says "verify" must pass before moving on.

---

## Prerequisites

Before starting, prepare the following accounts in a fresh database (run `./run.sh backend` with a clean DB so migrations run from scratch):

| Account | Role | Purpose |
|---|---|---|
| `alice@test.com` | Org OWNER | primary actor throughout the plan |
| `bob@test.com` | Org MEMBER | secondary actor |
| `carol@test.com` | Org MEMBER | third actor |
| `dave@test.com` | Org MEMBER | fourth actor (used for transfer ownership targets) |
| `eve@test.com` | Org ADMIN | org-admin bypass tester |
| `frank@test.com` | Org MEMBER (Projects domain admin) | domain-admin bypass tester |
| System admin account | System ADMIN | for system-level checks |

Create two groups:
- `group-editors` -- members: bob, carol
- `group-blocked` -- members: dave

Log in as `alice` to start. Open a second incognito window for `bob` (or use a separate browser). You will switch between accounts frequently.

---

## 1. Fresh database and org defaults

**As alice (org owner), go to `/admin/permissions`.**

Verify the page shows the new org-defaults table with two columns: "Default Access Mode" and "Default Baseline Role" for each content type.

| Content type | Expected default access mode | Expected default baseline role |
|---|---|---|
| Note | OWNER_ONLY | - |
| File | OWNER_ONLY | - |
| Calendar Event | OPEN_TO_ORG | VIEWER |
| Project | OPEN_TO_ORG | EDITOR |
| Agent | OPEN_TO_ORG | VIEWER |
| Room | OPEN_TO_ORG | VIEWER |
| Provider Key | OWNER_ONLY | - |
| Prompt | OPEN_TO_ORG | VIEWER |

1. Change "Note" default to `OPEN_TO_ORG / VIEWER`. Save.
2. Verify the page reloads and shows the new values.
3. Revert "Note" back to `OWNER_ONLY`. Save.
4. Verify the revert persists after a page refresh.

---

## 2. Notes

### 2.1 Default access (OWNER_ONLY)

1. As alice, create a note titled `Note A`.
2. Verify it appears in the **Personal** section of the notes sidebar (not Organization, not Shared).
3. As bob, open `/notes`. Verify `Note A` does not appear anywhere in the sidebar.
4. As bob, attempt to navigate directly to `Note A`'s URL. Verify a "not found" or "no permission" screen appears.

### 2.2 Open to org

1. As alice, open `Note A` settings > Access panel.
2. Change access mode to `OPEN_TO_ORG`, set baseline role to `VIEWER`. Save.
3. Verify `Note A` moves to the **Organization** section of alice's sidebar (not Personal).
4. As bob, refresh. Verify `Note A` appears in bob's **Organization** section.
5. As bob, open `Note A`. Verify it opens in read-only mode (no edit controls active).
6. As bob, attempt to edit the note body. Verify the edit is rejected or the save button is disabled.

### 2.3 Explicit member with EDITOR role

1. As alice, open `Note A` settings > Access panel.
2. Change access mode to `EXPLICIT_MEMBERS`.
3. Verify the warning: "Carol and Bob (via org baseline) will lose access. Only explicit members keep it."
4. Confirm the transition.
5. Verify `Note A` disappears from bob's sidebar.
6. As alice, add bob as EDITOR via the Add Member control.
7. As bob, refresh. Verify `Note A` appears in bob's **Shared with me** section.
8. As bob, open `Note A` and edit the body. Verify the change saves successfully.
9. As bob, attempt to open the Access panel and change the access mode. Verify this is rejected (bob is EDITOR, not ADMIN/OWNER).

### 2.4 COMMENTER role

1. As alice, add carol as COMMENTER to `Note A`.
2. As carol, open `Note A`. Verify she can read the content.
3. As carol, attempt to edit the note body. Verify editing is blocked.
4. As carol, add a comment (via the Comments tab). Verify the comment saves.
5. As carol, attempt to delete the note. Verify deletion is rejected.

### 2.5 BLOCKED on OPEN_TO_ORG content

1. As alice, create `Note B` with access mode `OPEN_TO_ORG / VIEWER`.
2. Verify bob can see `Note B` in his Organization section.
3. As alice, open `Note B` Access panel and add dave as BLOCKED.
4. As dave, refresh. Verify `Note B` does NOT appear in dave's sidebar.
5. As dave, attempt to navigate directly to `Note B`'s URL. Verify access is denied.
6. As alice (org owner), open `Note B`. Verify alice still sees it normally (owner bypasses BLOCKED).
7. As eve (org admin), open `Note B`. Verify eve sees it (org admin bypasses all BLOCKED).

### 2.6 BLOCKED via group

1. As alice, open `Note B` Access panel. Add `group-blocked` (dave's group) as BLOCKED.
2. Verify dave still cannot access `Note B` (BLOCKED via group).
3. Remove dave individually from `Note B`'s member list (keep `group-blocked` BLOCKED).
4. Verify dave still cannot access `Note B` (still BLOCKED via group).
5. Remove dave from `group-blocked` (go to `/admin/groups`).
6. As dave, verify `Note B` now appears in his Organization section (BLOCKED via group lifted).
7. Re-add dave to `group-blocked` after this check.

---

## 3. Files

### 3.1 File upload and default access

1. As alice, upload a file `test-file.pdf` to the root folder.
2. Verify it appears in alice's **Personal** files section (OWNER_ONLY default).
3. As bob, verify the file does not appear in his files.

### 3.2 Folder access inheritance

1. As alice, create a folder `Shared Docs` with access mode `OPEN_TO_ORG / VIEWER`.
2. As bob, verify the folder appears in his Organization section.
3. As alice, upload `team-file.pdf` directly inside `Shared Docs`.
4. Verify `team-file.pdf` has `OPEN_TO_ORG / VIEWER` access (inherits from the create path via org defaults or explicit policy).
5. As bob, verify he can view `team-file.pdf` but cannot delete it.

### 3.3 File details panel -- Access tab

1. As alice, open `test-file.pdf` details panel.
2. Click the **Access** tab.
3. Verify the `AccessPolicyPanel` renders: shows owner (alice), access mode (OWNER_ONLY), no member rows.
4. Add bob as EDITOR.
5. As bob, verify `test-file.pdf` appears in his **Shared with me** section.
6. As bob, open the file. Verify he can rename or update metadata (EDITOR).
7. As bob, attempt to delete the file. Verify deletion is rejected (EDITOR cannot delete; requires ADMIN).

---

## 4. Calendar Events

### 4.1 Default access (OPEN_TO_ORG / VIEWER)

1. As alice, create an event `Team Meeting` on any date.
2. As bob, verify `Team Meeting` appears on his calendar.
3. As bob, open the event detail. Verify it is read-only.
4. As bob, attempt to edit the event. Verify edit is blocked.

### 4.2 BLOCKED attendee on OPEN_TO_ORG event

1. As alice, open `Team Meeting` access panel and add carol as BLOCKED.
2. As carol, verify `Team Meeting` no longer appears on her calendar.
3. As carol, attempt direct URL navigation to the event. Verify access denied.

### 4.3 EXPLICIT_MEMBERS event

1. As alice, create a private event `1-on-1 with Bob` with access mode `EXPLICIT_MEMBERS`.
2. As bob, verify the event does NOT appear on his calendar.
3. As alice, add bob as VIEWER to the event.
4. As bob, verify `1-on-1 with Bob` now appears on his calendar.

---

## 5. Projects

### 5.1 Default access (OPEN_TO_ORG / EDITOR)

1. As alice, create a project `Team Project`.
2. Verify `Team Project` appears in alice's **Organization** section of the projects sidebar (OPEN_TO_ORG).
3. As bob, verify `Team Project` appears in his **Organization** sidebar section.
4. As bob, create a task in `Team Project`. Verify it saves (EDITOR can create tasks).
5. As bob, attempt to open project settings > General. Verify this is blocked or the settings controls are read-only (EDITOR cannot manage settings).

### 5.2 Tasks delegate to parent project

1. As alice, set `Team Project` to `EXPLICIT_MEMBERS` with bob as EDITOR.
2. As carol, verify she can no longer see `Team Project` or any of its tasks.
3. As carol, attempt direct URL navigation to a task. Verify access denied.
4. Verify bob can still see and edit tasks in the project.

### 5.3 Sprint access follows project

1. As alice, create a sprint `Sprint 1` in `Team Project`.
2. As carol (no project access), attempt to view Sprint 1 directly. Verify access denied.
3. As bob (explicit EDITOR), verify Sprint 1 is visible and manageable.

### 5.4 Project settings -- Access section

1. As alice, open `Team Project` settings.
2. Verify there is an "Access" or "Members" section with the `AccessPolicyPanel`.
3. Remove the explicit OWNER_ONLY setting by switching to `OPEN_TO_ORG / EDITOR`.
4. Verify the change is reflected immediately in the sidebar (project moves to Organization section).

---

## 6. Agents

### 6.1 Default access (OPEN_TO_ORG / VIEWER)

1. As alice, create an agent `My Assistant`.
2. As bob, verify `My Assistant` is visible in the agents list.
3. As bob, open the agent and start a chat session. Verify it works.
4. As bob, attempt to edit the agent's instructions. Verify this is blocked (VIEWER cannot edit).

### 6.2 EXPLICIT_MEMBERS agent (private agent)

1. As alice, create agent `Private Agent` with access mode `OWNER_ONLY`.
2. As bob, verify `Private Agent` does NOT appear in the agents list.
3. As alice, add bob as VIEWER to `Private Agent`.
4. As bob, verify `Private Agent` is now visible and usable.

### 6.3 Provider Keys (OWNER_ONLY)

1. As alice, add a provider key under Integrations.
2. As bob, navigate to the integrations/providers area. Verify alice's provider key is not visible.
3. As eve (org admin), verify the provider key IS visible (org admin bypasses OWNER_ONLY).

---

## 7. Rooms

### 7.1 Default access (OPEN_TO_ORG / VIEWER)

1. As alice (or via `/admin/rooms`), create a room `Conference Room A`.
2. As bob, navigate to the rooms section. Verify `Conference Room A` is visible.
3. As bob, attempt to book the room. Verify booking is possible (VIEWER can book, or verify whatever VIEWER allows).

### 7.2 BLOCKED from room

1. As alice, open `Conference Room A` access panel. Add carol as BLOCKED.
2. As carol, verify the room does not appear in her room list.
3. As carol, attempt direct URL. Verify access denied.

---

## 8. Role capability matrix

Open `Note A` with access mode `EXPLICIT_MEMBERS` and the following explicit members:
- bob: VIEWER
- carol: COMMENTER
- dave: EDITOR

Test each action for each role. Expected outcomes:

| Action | VIEWER (bob) | COMMENTER (carol) | EDITOR (dave) | OWNER (alice) |
|---|---|---|---|---|
| Read note | allowed | allowed | allowed | allowed |
| Edit note body | blocked | blocked | allowed | allowed |
| Add comment | blocked | allowed | allowed | allowed |
| Delete note | blocked | blocked | blocked | allowed |
| Open Access panel | blocked | blocked | blocked | allowed |
| Add a member | blocked | blocked | blocked | allowed |
| Change access mode | blocked | blocked | blocked | allowed |

Then add frank as ADMIN and verify:

| Action | ADMIN (frank) |
|---|---|
| Read note | allowed |
| Edit note body | allowed |
| Delete note | allowed |
| Open Access panel | allowed |
| Add a member | allowed |
| Change access mode | allowed |
| Transfer ownership | blocked (only OWNER can transfer) |

---

## 9. Transfer ownership

1. As alice, open `Note A` Access panel.
2. Click Transfer Ownership.
3. Select dave as the new owner.
4. Confirm the transfer.
5. Verify:
   - dave is shown as the new Owner in the Access panel.
   - alice now appears in the member list with role ADMIN.
   - The audit log shows an `OWNERSHIP_TRANSFERRED` event.
6. As dave, open `Note A`. Verify dave can now transfer ownership again and has full control.
7. As alice, verify she still has ADMIN access (can edit, manage members, delete).
8. As alice, attempt to transfer ownership away from dave. Verify this is rejected (alice is ADMIN, not OWNER).

---

## 10. Org admin bypass

1. Set `Note A` to `EXPLICIT_MEMBERS` with no members other than alice (owner).
2. As eve (org admin), verify `Note A` appears in her notes list (org admin sees all org content).
3. As eve, open `Note A`. Verify full OWNER-level access (can edit, manage, delete).
4. Add dave as BLOCKED to `Note A`.
5. As eve, verify she still sees `Note A` (org admin is never BLOCKED).

---

## 11. Domain admin bypass

1. Grant frank domain admin for Projects (go to `/admin/domain-admins`, assign frank to Projects domain).
2. As alice, create `Secret Project` with access mode `OWNER_ONLY`.
3. As frank, verify `Secret Project` appears in his projects list (domain admin sees all projects).
4. As frank, open `Secret Project`. Verify ADMIN-level access (can edit, manage members, delete, but cannot transfer ownership).
5. As frank, navigate to a Notes page. Verify frank does NOT have elevated access to notes he was not explicitly added to (domain admin is scoped to Projects only).
6. Add dave as BLOCKED to `Secret Project`.
7. As frank (projects domain admin), verify he still sees `Secret Project` (domain admin is not BLOCKED by content-level BLOCKED).

---

## 12. Audit log (Access history)

1. As alice, open `Note A` Access panel and navigate to the "Access History" or "Audit Log" tab.
2. Verify the log shows the following events in reverse chronological order:
   - Every MEMBER_ADDED, MEMBER_REMOVED, MEMBER_ROLE_CHANGED event for any member action taken in tests above.
   - Every ACCESS_MODE_CHANGED event for each mode change.
   - The OWNERSHIP_TRANSFERRED event from section 9.
3. For each event row, verify:
   - Actor avatar and name are shown.
   - The action description is human-readable (e.g. "Alice added Bob as Editor").
   - The timestamp is correct.
4. Filter by actor: select bob. Verify only events where bob was the actor appear.
5. Filter by action type: select ACCESS_MODE_CHANGED. Verify only access mode events appear.
6. Verify the log is read-only (no edit or delete controls).
7. Delete alice's account (from system admin panel). Reopen the audit log for `Note A`. Verify events where alice was the actor still appear, but show "Former member" or similar placeholder for the actor name.

---

## 13. Sidebar bucketing

### Notes sidebar

1. Ensure alice has:
   - `Note A`: EXPLICIT_MEMBERS (owned by alice, alice is OWNER)
   - `Note B`: OPEN_TO_ORG (owned by alice)
   - `Note C` (new): shared FROM carol to alice with EXPLICIT_MEMBERS + alice as VIEWER
2. Verify alice's sidebar shows:
   - **Personal**: `Note A` (owned, not open-to-org)
   - **Organization**: `Note B` (owned but OPEN_TO_ORG → goes here, not Personal)
   - **Shared with me**: `Note C` (not owned by alice, explicit member)

### Files sidebar

1. Repeat the equivalent test with files/folders.
2. Verify the same three-bucket logic applies.

### Projects sidebar

1. Verify `Team Project` (OPEN_TO_ORG, owned by alice) appears in **Organization**, not Personal.
2. Create `Private Project` (OWNER_ONLY). Verify it appears in **Personal**.
3. As bob, verify only the projects he has access to appear in the appropriate bucket.

---

## 14. Search respects access control

1. Ensure `Note A` is EXPLICIT_MEMBERS with bob as EDITOR and carol has no access.
2. As carol, use the search bar to search for `Note A`'s title.
3. Verify `Note A` does NOT appear in carol's search results.
4. As bob, search for `Note A`. Verify it appears in search results.
5. Set `Note A` back to OPEN_TO_ORG.
6. As carol, search again. Verify `Note A` now appears.
7. Add carol as BLOCKED to `Note A`.
8. As carol, search again. Verify `Note A` does NOT appear (BLOCKED wins over OPEN_TO_ORG).
9. As eve (org admin), search for content that carol is BLOCKED from. Verify eve sees it (org admin bypass).

---

## 15. Access mode transition warnings

### OPEN_TO_ORG to EXPLICIT_MEMBERS

1. As alice, open a note that is `OPEN_TO_ORG / VIEWER` with several org members who rely on the baseline.
2. Switch the access mode to `EXPLICIT_MEMBERS`.
3. Verify the UI shows a warning: "X members will lose access. Only explicitly added members will keep it." with the affected count.
4. Confirm the transition.
5. Verify affected org members can no longer access the note.

### EXPLICIT_MEMBERS to OWNER_ONLY

1. As alice, open a note that is `EXPLICIT_MEMBERS` with bob, carol, and dave as explicit members.
2. Switch the access mode to `OWNER_ONLY`.
3. Verify the UI shows a confirmation: "This will remove 3 members. Continue?"
4. Confirm.
5. Verify all three members are removed from the member list.
6. Verify all three can no longer access the note.
7. Verify the audit log shows MEMBER_REMOVED events for each of the three, plus an ACCESS_MODE_CHANGED event.

### Cancelling a transition

1. As alice, start switching a note from `OPEN_TO_ORG` to `OWNER_ONLY`.
2. When the warning dialog appears, click Cancel.
3. Verify the access mode was NOT changed.

---

## 16. Temporary access (expires_at)

1. As alice, open `Note A` Access panel.
2. Add bob as VIEWER with an expiration set 1 minute in the future.
3. Verify bob can access `Note A`.
4. Wait for the expiration to pass (or manually advance the clock if dev tools allow).
5. Refresh as bob. Verify `Note A` no longer appears in bob's sidebar.
6. Verify direct URL access also fails for bob after expiration.
7. Verify the audit log still shows the original MEMBER_ADDED event (expired grants are not deleted from the audit log).

---

## 17. Chat (visibility dropped)

1. As alice, create a public channel `#general`.
2. Verify bob can see and join `#general` (channel_type controls access, unchanged).
3. Verify there is no "visibility" field anywhere in the channel creation or settings UI.
4. Create a private channel `#leadership`.
5. Verify bob cannot see or join `#leadership` without an invitation (channel_type controls this, not the old visibility column).

---

## 18. Organizations admin defaults after org creation

1. As system admin, create a new organization `Test Corp`.
2. Log in as any user in `Test Corp`.
3. Go to `/admin/permissions`.
4. Verify the defaults table is populated with the correct built-in defaults (not empty/null).
5. Change the `NOTE` default to `OPEN_TO_ORG / VIEWER`.
6. As alice in `Test Corp`, create a note.
7. Verify the new note is created with `OPEN_TO_ORG / VIEWER` (inherits the org default).

---

## 19. Graceful display for former owner

1. Create a note owned by `carol@test.com`.
2. Delete carol's account from the system admin panel.
3. As alice, navigate to the notes list.
4. Verify any notes previously owned by carol still appear (content is not deleted).
5. Open one of carol's former notes.
6. Verify the owner display shows "Former member" (or a grayed-out avatar with that label) rather than a broken or empty state.
7. Verify alice (as org admin) can still open, edit, and manage members of carol's former notes.

---

## 20. Final lint check

After completing all manual tests, run:

```bash
./run.sh lint-backend
./run.sh test
./run.sh lint-frontend
./run.sh test-frontend
```

All four commands must be clean before the permissions redesign is considered complete.

---

## Known gaps (out of scope for this test plan)

- Recursive folder-to-file inheritance (planned follow-up)
- Expired grant cleanup cron (planned follow-up)
- Bulk "re-home orphaned content" tool (planned follow-up)
- Public/external sharing (not in this rewrite)
- GDPR anonymization of audit log actor fields (planned follow-up)
