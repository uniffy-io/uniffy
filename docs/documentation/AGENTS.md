# Agents in Uniffy

Agents are AI assistants that live inside your workspace. They can answer questions,
search your notes, create tasks, manage your calendar, and run dozens of other
actions on your behalf. You talk to them the same way you talk to a teammate:
open a chat and start typing.

Agents always act as **you**. They inherit the exact same permissions you have in
the UI, never more. If you can't see a note, neither can your agent.

---

## Quick Start

1. Go to **Agents** in the left sidebar.
2. Click **New Agent**. Give it a name, an emoji, a short personality prompt, and
   pick which tools it's allowed to use.
3. Go to **Chat**, click the **New message** button, and pick your agent from the
   **Agents** section in the picker.
4. Type a message. The agent replies as a normal chat message.

That's it. Everything else on this page is details.

---

## What Agents Can Do

Agents get work done using three kinds of building blocks:

| Block | What it is | Example |
|---|---|---|
| **Tools** | Actions the agent can call. One tool per domain action. | `notes.create_note`, `calendar.list_events`, `tasks.delete_task` |
| **Skills** | Markdown instructions that shape the agent's behavior. | "Always format tables in Markdown", "Respond in French" |
| **Memories** | Facts the agent remembers across conversations. | "I work in the Marketing team", "My timezone is CET" |

When you configure an agent, you pick which tools it can use and which skills
are active. Memory is managed automatically as you chat.

---

## Creating an Agent

### Minimum setup

| Field | What to set |
|---|---|
| Name | Anything. Shows up as the agent's chat name. |
| Personality / soul prompt | Free-form Markdown. Describes how the agent behaves. Keep it short. |
| Avatar | Upload an image or pick an emoji. |
| Enabled tools | Check the tools the agent is allowed to use. Start small: read-only tools (`*.search_*`, `*.read_*`, `*.list_*`) are the safest. |
| Primary model | The LLM model to use (Claude, GPT, Gemini). Needs a provider key (see below). |

### Access mode

Agents follow the same access model as notes, files, and other content:

- **Owner only** — only you can use this agent.
- **Explicit members** — share with specific users or groups.
- **Open to org** — anyone in the organization can use it.

Share an agent the same way you share a note: from the agent detail page,
click **Share**.

---

## Talking to an Agent in Chat

### Starting a conversation

From **Chat**:

1. Click **New message** (the `+` button in the sidebar).
2. Type the agent's name in the search box. Agents show up in a section below
   the People results, marked with a Robot icon.
3. Click the agent, then **Start conversation**.
4. The DM opens. The agent's avatar and name appear in the sidebar.

If you already have a DM with an agent, just click it in the sidebar.

### What you see during a conversation

A conversation can contain several kinds of rows. Agents post all of them
automatically — you don't need to do anything special.

| Row type | When it shows up | What it looks like |
|---|---|---|
| **Text reply** | The agent's final answer | Same as any chat message, with the agent's avatar |
| **Tool call** | Agent is running a tool | Compact card with a wrench icon and the tool name. Click **Show arguments** to inspect. |
| **Tool result** | Tool finished | Green check (success) or red X (failed). Click **Show result** to inspect. |
| **Approval card** | Agent wants to do something destructive | Yellow-bordered card with **Allow** / **Deny** buttons |
| **Approved / Denied** | After you decide | Thin status row confirming the decision |
| **Summary** | Long conversation was compacted | Faint "Conversation summary" row |

### The typing indicator

While the agent is generating a reply, you'll see **"&lt;Agent name&gt; is typing"**
with the agent's avatar at the bottom of the channel — the same indicator humans
get.

---

## Approvals for Destructive Actions

Some tools can't be undone: deleting notes, deleting tasks, deleting calendar
events, deleting projects. When the agent wants to run one of these, it pauses
and asks for your approval.

### What happens

1. Agent posts a yellow-bordered card: **"Approval required: Delete note"**.
2. Click **Allow** to let the tool run, or **Deny** to reject it.
3. The card disappears and a status row replaces it (**Approved** or **Denied**).
4. If approved, the agent continues its work and posts the result.
5. If denied, the agent explains the action was rejected and stops or changes
   course.

### Who can approve

Only the person who triggered the destructive action sees the buttons. Everyone
else in the channel sees the card with a muted **"Waiting for the requester to
approve..."** message.

### Approvals time out

Pending approvals expire after 24 hours. If you don't decide, the agent treats
it as a denial.

> **Known limitation:** If you refresh the browser while an approval card is
> showing, the card disappears. The approval is still pending on the server
> until TTL, but the UI can't currently re-display it. A fix is planned.

---

## Built-in Tools

Agents ship with tools across every core Uniffy domain:

| Domain | Examples |
|---|---|
| Notes | Create, read, update, search, delete |
| Files | List, read content, update, delete |
| Projects | Create, update, list, delete |
| Tasks | Create, update, list, move, delete |
| Calendar | List events, create, update, delete, RSVP, manage attendees, free/busy lookup, find meeting times honoring each attendee's saved working hours and timezone |
| Search | Universal search across all content |
| People | List org members |
| Memory | Save, recall, list, forget |
| Scheduling | Create recurring scheduled agent tasks |
| Images | Generate images from text (requires an external provider) |

Destructive tools are marked and require approval in chat (see above).

Full list in **Agents > New Agent > Tools**.

Enabling many tools does not bloat every conversation: an agent with a large
tool set starts with its core groups (memory, search, people, skills, system
time) and loads other groups on demand the first time a request needs one.
You may see a brief `Load Group` step in the tool activity pane; after that
the group stays loaded for the rest of that conversation. This keeps replies
fast and context lean without changing what the agent is allowed to do.

---

## Skills

Skills are reusable Markdown instructions. Think of them as prompt fragments you
can mix into an agent.

There are three scopes:

| Scope | Who can create | Who can use |
|---|---|---|
| **Bundled** | Ship with Uniffy (read-only) | Everyone |
| **Organization** | Org admins | Everyone in the org |
| **Personal** | You | Only you |

A skill is just a Markdown file with a name. Example skill:

```markdown
# Meeting Minutes

When asked to write meeting minutes, always produce:
- A one-paragraph summary at the top
- A "Decisions" section with bullet points
- An "Action items" section with owner names
- A "Next meeting" section if a follow-up was discussed
```

Attach skills to an agent in **Agents > &lt;agent&gt; > Skills**. Mark a skill as
**always active** to have it injected into every conversation with any agent.

---

## Memory

Memories are key-value facts the agent remembers.

- The agent **saves** memories automatically when you tell it something worth
  remembering ("my timezone is CET", "I hate 3pm meetings").
- You can also ask the agent directly: *"Remember that I prefer Markdown tables
  over HTML"*.
- The top 10 most important memories are loaded into every prompt.

Memories are scoped per `(agent, you, channel)`. The same agent in two different
DM channels keeps separate memory — a work agent and a personal agent never see
each other's notes even if it's technically the same agent definition.

To review or delete memories, open the agent page and go to the **Memory** tab.

---

## Provider Keys

Agents are LLM-powered. Before any agent can reply, an org admin must add at
least one provider key.

| Provider | How to get a key |
|---|---|
| Anthropic (Claude) | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) |
| OpenAI (GPT) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Google (Gemini) | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) |
| xAI (Grok) | [console.x.ai](https://console.x.ai) |

Org admins add keys at **Admin > Agents > Keys**. Pick the provider, and the
form links straight to that provider's key page and API docs. Keys are
encrypted at rest. A key must be both **valid** and **enabled** to be used.

If no provider is configured, the agent picker shows a banner with a link to
the config page. Agents won't reply until a key is enabled.

---

## Enabling Agents in Chat

Agents-in-chat is gated by an org-level flag, on by default. Org admins toggle
it under **Admin → Agents → General** ("Agents in chat"). When off, the
**Agents** section disappears from the New Message picker and agents stop
replying to DMs and mentions. The flag lives in the org chat policy alongside
the other chat policy settings.

---

## Permissions, Privacy, Safety

| Property | What it means |
|---|---|
| Agents never gain privileges | An agent can only access content you can already access. If you get BLOCKED on a note, so does the agent when you ask it to read that note. |
| Org-scoped | Agents can't reach across organizations. Every call passes `organization_id`. |
| Destructive actions need approval | Deletes pause and wait for you to click Allow. |
| Errors are contained | A failed tool returns an error the agent can explain; it never crashes the whole conversation. |
| Iteration limit | An agent can chain at most 10 tool calls per turn. No infinite loops. |
| Provider keys encrypted | Stored encrypted at rest, decrypted only when a call is made. |

---

## Tips

- **Start with a read-only agent.** Enable `notes.search_notes`, `files.search_files`,
  `search.query`, and `people.list_members`. You'll be surprised how far that gets you.
- **Write a tight personality prompt.** Two sentences beats two paragraphs.
- **Use skills for reusable behavior.** If you find yourself saying the same
  instructions every conversation, move them into a skill.
- **Mention content with `@`.** Just like in notes, you can `@mention` any
  note, file, project, or task in your chat message. The agent will see the
  reference and can act on it directly.
- **Name the tool you want.** Agents decide which tool to use, but if you say
  *"use search_notes, not a general web search"* the agent will listen.

---

## What's Coming Next

Current state is the MVP: 1:1 DMs with agents, approvals, typing indicators,
tool cards. The roadmap:

| Feature | Status |
|---|---|
| Pending approvals that survive a page reload | Planned |
| `@agent_name` mention inside regular channels to pull an agent into a group conversation | Phase 5 |
| Thread replies that trigger an agent when its message is the root | Phase 5 |
| Per-token streaming so replies appear word-by-word | Phase 2 polish |
| Per-channel rate limit + binding configuration UI | Phase 5 |
| Search indexing of agent messages | Phase 2 polish |
| Long-conversation compaction for channel DMs | Phase 2 polish |

---

## Troubleshooting

| Problem | First thing to try |
|---|---|
| "New message" picker has no Agents section | The `agents_enabled` flag is off for your org, or the agents slice hasn't loaded. Refresh once. If it persists, ask an admin. |
| I sent a message, nothing happened | Background worker might be down; provider key might be missing or disabled. Check with an admin. |
| Agent replied with "No active LLM provider" in the logs | Org needs a valid, enabled provider key. |
| Approval card disappears when I refresh | Known limitation — approval is still pending server-side for 24h, but the card can't currently be re-rendered. Restart the conversation or wait for the planned fix. |
| Agent can't see a note I referenced | Check you have view access to the note. The agent inherits your permissions exactly. |
| Tool arguments show `{'note_id': '...'}` with single quotes | Expected. Backend formatting follow-up planned. |

---

## Further Reading

- **Sharing** — how access modes and explicit members work → `docs/documentation/SHARING.md`
- **Searching** — universal `@` mentions and search filters → `docs/documentation/SEARCHING.md`
