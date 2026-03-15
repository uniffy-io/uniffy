# Cortex Agents — Manual Test

Two agents to create and test: one scoped to Notes, one scoped to Projects.

---

## Prerequisites

- Logged in as an **org admin**
- At least one valid, **enabled** provider key configured under **SYSTEM → Config**
- Navigate to **Cortex → Builder**

---

## Agent 1 — Notes Assistant

### Create

1. In the **My Agents** section click **+**
2. Fill the form:
   - **Name:** `Notes Assistant`
   - **Model:** pick any available model
3. Click **Create Personal Agent** — the agent should appear in the list and be auto-selected

### Instructions tab

Switch to the **Instructions** tab. Two paths:

**Option A — Chat (Prompt Builder):**
Send this message to let the AI draft the instructions for you:
> You are a helpful assistant that can create, read, edit, and search notes in a workspace. Help users capture ideas, summarize content, and organize information as notes. Always confirm before deleting anything.

Then click **Apply to Instructions** on the response and verify the textarea updates.

**Option B — Direct Edit:**
Click **Switch to Direct Edit** and paste:
```
You are a Notes assistant for a collaborative workspace.

You can create, read, edit, list, and delete notes. When a user asks you to capture something, create a note automatically. When searching, always show the title and a short excerpt. Never delete a note without explicit confirmation.
```

### Tools tab

1. Switch to the **Tools** tab
2. Under the **Notes** group enable all 5 tools:
   - `notes.list_notes` — List Notes
   - `notes.get_note` — Read Note
   - `notes.create_note` — Create Note
   - `notes.update_note` — Edit Note
   - `notes.delete_note` — Delete Note (destructive — marked with warning icon)
3. Also enable `search.query` from the **Search** group so the agent can find notes by content
4. Leave all other groups disabled

Expected: 6 tools checked, the toggle in the row header should reflect the count.

### Verify in Chat

1. Go to **Cortex → Chat**
2. Confirm the header shows **Connected** (green dot)
3. Send:
   > Create a note called "Test Note" with the content "This is a test created by the Notes Assistant."

   Expected: agent calls `notes.create_note`, tool card appears, then confirms success.

4. Send:
   > List all my notes

   Expected: agent calls `notes.list_notes`, returns a list.

5. Send:
   > Search for "test"

   Expected: agent calls `search.query`, returns matching results.

---

## Agent 2 — Projects Assistant

### Create

1. In the **My Agents** section click **+**
2. Fill the form:
   - **Name:** `Projects Assistant`
   - **Model:** pick any available model
3. Click **Create Personal Agent**

### Instructions tab

Switch to **Instructions → Direct Edit** and paste:
```
You are a Projects assistant for a collaborative workspace.

You can create and manage projects and tasks. When a user describes a project, create it with a clear name and description. When listing projects always include their current task count. For tasks, always confirm the target project before creating. Never delete projects or tasks without explicit confirmation.
```

### Tools tab

Enable the following tools only:

**Projects group:**
- `projects.list_projects` — List Projects
- `projects.create_project` — Create Project
- `projects.update_project` — Edit Project
- `projects.delete_project` — Delete Project (destructive)

**Tasks group:**
- `tasks.list_tasks` — List Tasks
- `tasks.create_task` — Create Task
- `tasks.update_task` — Edit Task
- `tasks.move_task` — Move Task
- `tasks.delete_task` — Delete Task (destructive)

**People group:**
- `people.list_members` — List Members (useful for task assignment)

Leave Notes, Calendar, and Search disabled.

### Verify in Chat

1. Go to **Cortex → Chat**
2. Select the **Projects Assistant** session (create a new one if needed via the Conversations tab)
3. Send:
   > Create a project called "Website Redesign" with a brief description

   Expected: agent calls `projects.create_project`, tool card appears, confirms.

4. Send:
   > Add a task to Website Redesign: "Design homepage mockup", high priority

   Expected: agent calls `tasks.create_task`, assigns it to the right project.

5. Send:
   > List all projects

   Expected: agent calls `projects.list_projects`, returns the list including the one just created.

6. Send:
   > Mark the "Design homepage mockup" task as done

   Expected: agent calls `tasks.update_task` or `tasks.move_task` to update the status.

---

## Disconnect test

1. Go to **SYSTEM → Config**
2. Find the provider key and toggle it **off** (the row will dim)
3. Go to **Cortex → Chat**
4. Confirm:
   - Header shows **Disconnected** (grey dot, no ping)
   - Input area replaced by: *"No AI provider configured or available. Enable a provider key in SYSTEM → Config to start chatting."*
   - The **SYSTEM → Config** text is a clickable link that takes you back to the config panel
5. Re-enable the key and confirm the chat returns to **Connected** after refreshing the page or navigating away and back

---

## Checklist

- [ ] Notes Assistant created and visible in My Agents
- [ ] Notes Assistant instructions saved (edit mode shows the text)
- [ ] Notes Assistant has exactly 6 tools enabled (5 notes + search.query)
- [ ] Notes Assistant can create a note via chat
- [ ] Notes Assistant can list and search notes
- [ ] Projects Assistant created and visible in My Agents
- [ ] Projects Assistant has exactly 10 tools enabled (4 projects + 5 tasks + people.list_members)
- [ ] Projects Assistant can create a project via chat
- [ ] Projects Assistant can create and update a task
- [ ] Disabling the provider key shows the Disconnected state in chat
- [ ] Re-enabling the key restores the Connected state
