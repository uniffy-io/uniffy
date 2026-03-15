# Agents Phase 0 + Phase 1 -- Manual Test Script

Step-by-step manual test for all features implemented in Phase 0 (Quick Wins) and Phase 1 (Core Intelligence).

---

## Prerequisites

- Logged in as an **org admin**
- At least one **enabled** provider key configured under **SYSTEM -> Config** (Anthropic, OpenAI, or Google)
- A few notes and projects already exist in the workspace (for tool testing)
- Navigate to **Agents -> Builder**

---

## 1. Agent Builder -- Overview Tab

### 1.1 Create an Agent

1. In the **My Agents** section click **+**
2. Fill: Name = `Test Agent`, Model = pick any available model
3. Click **Create Personal Agent**

**Expected:** Agent appears in the sidebar list and is auto-selected. The Overview tab is shown.

### 1.2 Avatar Emoji

1. In the **Agent Identity** section, type a single emoji (e.g. `🔬`) into the avatar field
2. Click away to blur

**Expected:** The sidebar agent card updates to show the emoji. Field label says "Single emoji or 2 characters".

### 1.3 Scope Selector

1. Note the **Scope** toggle: should default to **Personal** ("Only visible to you")
2. Click **Organization**

**Expected:** Scope switches to Organization ("Visible to all organization members"). Only org admins can set this.

3. Switch back to **Personal** for testing

### 1.4 Model Configuration

1. Verify **Primary Model** dropdown shows models from the enabled provider
2. Set **Temperature** slider to `0.7`
3. Set **Max Tokens** to `4096`
4. In **Fallback Models** type a comma-separated model name (e.g. the same provider's smaller model)

**Expected:** All fields save on change. Temperature shows "0 = deterministic, 1 = creative" label. Max tokens range is 256-128000.

### 1.5 Default Agent Toggle

1. Enable the **Default Agent** toggle

**Expected:** Label says "Used when creating new sessions without specifying an agent". If another agent was default, it gets unset.

### 1.6 Read-only Stats

**Expected:** The Overview shows two read-only cards: "Skills Enabled" (count) and "Tools Enabled" (count). Both should read `0` for a fresh agent.

---

## 2. Agent Builder -- Instructions Tab

### 2.1 Direct Edit Mode

1. Switch to the **Instructions** tab
2. If not already in edit mode, click the **Switch to Direct Edit** toggle
3. Paste the following into the textarea:
   ```
   You are a helpful test assistant for a workspace platform.
   You can manage notes, projects, tasks, and calendar events.
   Always confirm before performing destructive actions.
   Remember user preferences across conversations.
   ```
4. Click away to blur (auto-saves)

**Expected:** Character count updates in the bottom-right corner. The text persists when switching tabs and coming back.

### 2.2 Clear Button

1. In Direct Edit mode, verify the **Clear** button (eraser icon) is visible in the bottom-left footer
2. Click **Clear**

**Expected:** The textarea empties immediately. The agent's soul prompt is cleared (character count shows `0`). The Clear button becomes disabled when empty.

3. Re-paste the instructions from step 2.1

### 2.3 Chat Mode (Prompt Builder)

1. Click **Switch to Chat** to enter prompt builder mode
2. Verify the empty state shows: "Send a message to start building your agent's instructions"

**Expected:** A new session is created silently (GROUP kind, display name prefixed with `[prompt-builder]`).

3. Send a message:
   > Build me a system prompt for an agent that manages tasks and notes. It should be professional and concise.

**Expected:** The AI responds with a drafted system prompt. An **"Apply to Instructions"** button (with arrow icon) appears on the assistant's message bubble.

4. Click **Apply to Instructions**

**Expected:** The mode switches to Direct Edit showing the applied text. The agent's soul prompt is updated.

### 2.4 New Chat Button

1. Switch back to **Chat** mode
2. Click the **New Chat** button (counter-clockwise arrow icon, top-right)

**Expected:** The chat clears completely. A fresh session starts. Old messages are gone. The empty placeholder text shows again.

### 2.5 System Prompt Preview (Overview Tab)

1. Switch to the **Overview** tab
2. Look at the system prompt section

**Expected:** If the instructions are longer than ~7 lines, only a preview is shown with a gradient fade at the bottom and a **"Show more"** button. Clicking it expands to full text. **"Show less"** collapses it back.

---

## 3. Agent Builder -- Tools Tab

### 3.1 Tool Groups and Toggles

1. Switch to the **Tools** tab
2. Verify the following groups are shown:

| Group | Tools | Destructive |
|-------|-------|-------------|
| Notes | Create Note, Edit Note, Delete Note, List Notes, Read Note | Delete Note |
| Projects | Create Project, Edit Project, Delete Project, List Projects | Delete Project |
| Tasks | Create Task, Edit Task, Delete Task, List Tasks, Move Task | Delete Task |
| Calendar | Create Event, Edit Event, Delete Event, List Events | Delete Event |
| Search | Search Content | -- |
| People | List Members | -- |

**Expected:** Each group shows a header with a group-level checkbox and count (e.g. "0/5 enabled"). Destructive tools have a warning icon.

### 3.2 Individual Toggle

1. Toggle ON `notes.create_note` (Create Note)

**Expected:** Toggle turns green. Group header updates to "1/5 enabled". The Overview tab's "Tools Enabled" count updates to `1`.

### 3.3 Group Toggle (Select All)

1. Click the group-level checkbox for **Notes**

**Expected:** All 5 notes tools are toggled ON. Header shows "5/5 enabled".

### 3.4 Toggle Off Last Tool

1. Disable all tools except one (e.g. only `search.query` remains)
2. Toggle OFF `search.query`

**Expected:** The toggle turns off. All tools are now disabled (0 total). This verifies the "clear last item" fix works.

### 3.5 Bulk Enable for Testing

1. Enable all tools in **Notes**, **Search**, and **People** groups (for chat testing later)

---

## 4. Agent Builder -- Skills Tab

### 4.1 Three Sections

1. Switch to the **Skills** tab
2. Verify three collapsible sections are shown:
   - **Bundled** -- system-provided skills
   - **Organization** -- org-level skills
   - **My Skills** -- personal skills with a **+** button

**Expected:** Each section has a collapsible header. Skills with `always_active` show a lock icon and "Always on" text.

### 4.2 Toggle a Skill

1. Find any non-locked skill and toggle it ON
2. Toggle it OFF

**Expected:** Toggle state saves immediately. The Overview tab's "Skills Enabled" count reflects the change.

### 4.3 Create Personal Skill

1. In the **My Skills** section, click the **+** button
2. Fill in:
   - Name: `test-skill`
   - Display Name: `Test Skill`
   - Description: `A test skill for manual QA`
   - Content: `When the user asks about testing, provide QA best practices.`
3. Click **Create**

**Expected:** The skill appears in the "My Skills" section with a "Mine" badge. It can be toggled on/off for this agent.

---

## 5. Enhanced System Prompt

### 5.1 Verify Context Injection

1. Go to **Agents -> Chat**
2. Send:
   > What is my name and what organization am I in?

**Expected:** The agent responds with your actual user name and organization name. This confirms the enhanced system prompt injects user identity and org context.

3. Send:
   > What tools do you have available?

**Expected:** The agent lists the tools you enabled (notes tools, search, people). This confirms tool descriptions are injected into the system prompt.

4. Send:
   > What is today's date?

**Expected:** The agent gives the correct current date. This confirms the date/time section in the system prompt.

---

## 6. Tool Execution

### 6.1 Create Content via Tool

1. In the chat, send:
   > Create a note called "Agent Test Note" with the content "Created by the test agent during manual QA."

**Expected:** The agent calls `notes.create_note`. A tool call card appears in the chat showing the tool name and arguments. The agent then confirms the note was created.

2. Navigate to **Notes** and verify the note exists

### 6.2 Read Content via Tool

1. Send:
   > List all my notes

**Expected:** The agent calls `notes.list_notes` and returns a list of notes including "Agent Test Note".

### 6.3 Search via Tool

1. Send:
   > Search for "Agent Test"

**Expected:** The agent calls `search.query` and returns matching results.

### 6.4 Multi-Tool Chain

1. Send:
   > Find the note called "Agent Test Note" and add a paragraph at the end saying "Updated by the agent."

**Expected:** The agent makes multiple tool calls in sequence: first `notes.list_notes` or `search.query` to find the note, then `notes.update_note` to edit it. The tool loop handles up to 10 iterations.

---

## 7. Human-in-the-Loop Approvals (Destructive Tools)

### 7.1 Trigger Approval

1. Make sure `notes.delete_note` is enabled in the Tools tab
2. In the chat, send:
   > Delete the note called "Agent Test Note"

**Expected:** The agent calls `notes.delete_note`. A **confirmation dialog** appears in the chat with the message: "The agent wants to execute notes.delete_note. This action is destructive." Two buttons: **Approve** and **Reject**.

### 7.2 Approve

1. Click **Approve**

**Expected:** The tool executes and the note is deleted. The agent confirms deletion.

### 7.3 Reject

1. Create another test note via chat
2. Ask the agent to delete it
3. When the confirmation appears, click **Reject**

**Expected:** The tool is NOT executed. The agent receives "Action was rejected by the user or timed out." and informs the user the action was cancelled.

### 7.4 Timeout

1. Ask the agent to delete a note
2. When the confirmation appears, do NOT click anything for ~2 minutes

**Expected:** After 120 seconds, the approval times out automatically. The agent receives the timeout message and responds accordingly.

---

## 8. Agent Memory

### 8.1 Save Memory

1. In the chat, send:
   > Remember that my preferred language for notes is English and I like bullet-point formatting.

**Expected:** The agent calls `memory.save` with a key like "preferred_language" or "formatting_preference". The tool call card shows in the chat. Agent confirms it saved the preference.

### 8.2 Recall Memory

1. Start a **new session** (navigate away and back, or use Conversations tab)
2. Send:
   > What do you remember about my preferences?

**Expected:** The agent calls `memory.recall` or `memory.list` and returns the previously saved preference about English language and bullet-point formatting. This proves memory persists across sessions.

### 8.3 List Memories

1. Send:
   > List all your memories about me

**Expected:** The agent calls `memory.list` and shows all stored memories with their keys and categories.

### 8.4 Forget Memory

1. Send:
   > Forget my language preference

**Expected:** The agent calls `memory.forget` with the appropriate key. Confirms the memory was deleted.

2. Send:
   > What do you remember about my preferences?

**Expected:** The deleted memory no longer appears. Other memories (if any) are still listed.

---

## 9. Session Context Compaction

> Note: This test requires generating a high volume of messages. It may consume significant tokens.

### 9.1 Trigger Compaction

1. Have a sustained conversation with the agent — send at least **40+ messages** back and forth (short messages like "What's 2+2?", "List my notes", etc.)

**Expected:** After exceeding 40 non-compacted messages, the system automatically compacts the oldest 30 messages into a summary. This happens silently. The conversation continues without interruption.

### 9.2 Verify Context Preserved

1. After compaction, reference something from early in the conversation:
   > What was the first thing I asked you?

**Expected:** The agent can still reference early context because it was summarized (not deleted). Responses may be less precise about exact wording but should capture the gist.

---

## 10. Multi-Provider Support

### 10.1 Verify Available Providers

1. Go to **SYSTEM -> Config**
2. Check that provider keys can be configured for:
   - **Anthropic** (Claude models)
   - **OpenAI** (GPT models)
   - **Google** (Gemini models)

**Expected:** Each provider section exists in the config panel.

### 10.2 Switch Provider

1. Enable a key for a different provider than you've been using
2. Go to **Agents -> Builder -> Overview**
3. Change the **Primary Model** dropdown to a model from the new provider
4. Go to **Agents -> Chat** and send a message

**Expected:** The agent responds using the new provider's model. The response should stream in normally with tool use still working.

### 10.3 Fallback Models

1. In the Overview tab, set a **Fallback Model** (comma-separated)
2. Disable the primary provider's key in SYSTEM -> Config
3. Send a message in chat

**Expected:** The system falls back to the next available model. If no fallback is available, an appropriate error message is shown.

---

## 11. Usage Analytics Dashboard

### 11.1 Navigate to Usage

1. Go to **Agents -> Usage** (or the usage/analytics view)

**Expected:** The dashboard loads with the following sections:

### 11.2 Stats Cards

Verify four stat cards are shown:

| Card | Icon | Content |
|------|------|---------|
| Total Runs | Lightning | Count of all agent runs |
| Total Tokens | Chart | Total with input/output breakdown in subtitle |
| Avg Duration | Clock | Average run time in seconds or milliseconds |
| Sessions | Chat bubble | Total session count |

**Expected:** Values reflect the testing activity performed above (should be non-zero).

### 11.3 Daily Token Chart

**Expected:** A bar chart showing daily token usage. Input tokens shown in full primary color, output tokens in 40% opacity primary color.

### 11.4 Breakdown Tables

Verify three tables:
- **By Model** -- columns: Model, Runs, Input tokens, Output tokens
- **By Agent** -- columns: Agent, Runs, Input tokens, Output tokens
- **Top Tools** -- columns: Tool name, Call count

**Expected:** The model and agent you tested with appear. Tools like `notes.create_note`, `memory.save`, etc. show their call counts.

---

## 12. Run Logging

### 12.1 Verify Logs Recorded

This is verified implicitly through the Usage dashboard (section 11). Every chat interaction creates an `AgentRunLog` entry that records:
- Model used
- Input/output token counts
- Tool calls (as JSON)
- Number of tool iterations
- Duration in milliseconds
- Status (success/error)

**Expected:** The Usage dashboard data reflects all runs from the testing session.

---

## 13. Conversations Management

### 13.1 User Sessions

1. Go to **Agents -> Conversations**
2. Verify the sessions table shows all chat sessions with columns:
   - Session name, Last Active, Messages, Tokens, Model, Thinking level, Archive button

**Expected:** All chat sessions from testing appear. Prompt builder sessions do NOT appear in this table.

### 13.2 Thinking Level

1. Change the **Thinking** dropdown on a session to "Medium"

**Expected:** The dropdown saves immediately. Next message in that session uses the selected thinking level.

### 13.3 Archive Session

1. Click the **trash icon** on a session

**Expected:** The session disappears from the list (archived). It no longer appears in the Chat tab session list.

### 13.4 Prompt Builder Section

1. Scroll down to the **Prompt Builder** collapsible section
2. Click to expand it

**Expected:** Shows all prompt builder sessions created during Instructions tab testing. Each row shows: agent emoji + name, last active, message count, tokens, archive button. The count badge on the section header matches the number of sessions.

3. Archive a prompt builder session

**Expected:** Session is removed from the list.

---

## 14. Disconnect / No Provider

1. Go to **SYSTEM -> Config**
2. Disable all provider keys
3. Go to **Agents -> Chat**

**Expected:**
- Header shows **Disconnected** (grey dot)
- Input area replaced by: "No AI provider configured or available. Enable a provider key in SYSTEM -> Config to start chatting."
- The "SYSTEM -> Config" text is a clickable link

4. Re-enable at least one key
5. Refresh or navigate away and back

**Expected:** Chat returns to **Connected** state with green dot. Messages can be sent again.

---

## Checklist

### Phase 0 -- Quick Wins
- [ ] All 19 built-in tools registered (5 notes + 4 projects + 5 tasks + 4 calendar + 1 search + 1 people)
- [ ] Tool naming uses consistent dotted convention (`domain.action`)
- [ ] Enhanced system prompt includes user name, org name, current date, URN format instructions
- [ ] Agent run logging captures model, tokens, tool calls, duration per interaction
- [ ] Soul prompt editor functional (direct edit + chat mode + apply button)

### Phase 1 -- Core Intelligence
- [ ] Session compaction triggers after 40+ messages, summarizes oldest 30
- [ ] Agent memory: save, recall, list, forget -- all work across sessions
- [ ] Human-in-the-loop: destructive tools show confirmation, approve/reject/timeout all work
- [ ] Multi-provider: Anthropic, OpenAI, Google all supported and switchable
- [ ] Usage dashboard: stats cards, daily chart, model/agent/tool breakdowns all populated

### Builder UI
- [ ] Overview tab: emoji, scope, model config, temperature, max tokens, fallback, default toggle
- [ ] Instructions tab: direct edit with clear button, chat mode with new chat, apply to instructions
- [ ] Instructions preview: collapsible ~7 lines with show more/less
- [ ] Tools tab: all groups render, individual toggles work, group checkboxes work, can clear last tool
- [ ] Skills tab: bundled/org/personal sections, toggle on/off, create personal skill
- [ ] Conversations: user sessions table, prompt builder collapsible section, archive works
