# Agents in Uniffy

Agents are AI assistants you talk to in Chat. They can answer questions and use the
workspace tools a builder enables for them. Every real tool call acts as the person
who sent the request, with that person's current permissions.

## Start a conversation

Open **Chat > New message**, choose an accessible agent, and start typing. You can
also mention an agent in a channel or continue its conversation in a thread.
Replies show the tools used and their results. Destructive actions require the
requester's approval.

An organization admin must configure an enabled, valid provider key and a default
model under **Admin > Agents** before agents can reply. Each agent can select a
different model. Provider use counts toward the organization's AI usage and budgets.

## Build and share an agent

Organization owners, admins, and Agents domain admins are builders. Open **Agents**
to create an agent or start from the **Catalog**. The builder has four panels:

- **Overview:** identity, description, and model settings.
- **Instructions:** the agent's personality and general instructions.
- **Capabilities:** selected rules, enabled tools, and available skills.
- **Memory:** organization memories shared with this agent.

Use the test drawer on an agent's page to try a conversation. Sharing controls who
can use the agent: owner only, explicit members, or everyone in the organization.
Builder management powers do not grant access to someone else's private agent or
workspace content.

## Instructions, rules, skills, tools, and memory

| Building block | Purpose | Example |
|---|---|---|
| Product instructions | Shipped behavior and workspace conventions | Follow the requesting person's access permissions |
| Rules | Guidance applied on every run of an agent that selected it | Cite sources when reporting facts |
| Skills | A reusable workflow a person invokes for one turn | Produce meeting minutes from the supplied transcript |
| Tools | Capabilities an agent can call with the person's permissions | Read a note or create a task |
| Memory | Contextual facts available to an agent | A team's preferred meeting hours |

Builders select rules independently for each agent in **Capabilities**. A rule's
bundled or organization source identifies who maintains its definition. It does
not enable the rule for every agent. An agent with no selected rules receives none.
Rules have version history and an active version; bundled definitions are read-only.

## Invoke a skill

Builders assign skills in an agent's **Capabilities** panel. Assignment makes a skill
available for invocation. To use one, select it from the slash menu in Chat or the
test drawer, then add your request. One turn invokes at most one skill. For example:

```text
/meeting-minutes Summarize this transcript and identify the action owners.
```

The skill's instructions are loaded for that turn. The command's remaining text
stays your message. Ordinary messages do not load assigned skills.

The menu offers skills compatible with the agent's available tools and the current
surface. Builders can see missing-tool and surface explanations in Capabilities.
If a selected skill becomes unavailable before sending, the invocation fails visibly;
review the explanation and adjust the selection. The resulting reply identifies the
exact skill version used.

Skills come from the bundled library or your organization. Builders edit organization
skills under **Agents > Skills**. Version history lets them choose an active version,
follow the latest saved version, or restore an earlier body as a new version.

## Create and improve skills from a conversation

Use **Create skill from conversation** on a reply and explain what the skill should
help with. After explicitly confirming, the configured model generates a draft from
the selected reply and its triggering message. The draft is visible to organization
builders for review.

The person who invoked a skill can use **Improve this skill** on its completed reply.
The proposal targets that invocation's recorded version. It does not guess a target
from the agent's other skills or from the current active version.

Generation shows its progress and any failure. The requester can explicitly retry a
failed attempt. Builders review, edit, save, or discard the draft in the Skills list.
A draft does not change any agent until saved. Replies and reactions do not trigger
generation automatically.

## Evaluate skill behavior

Open **Evaluations** in a skill or pending draft. Builders can keep up to 25 reusable
cases with:

- A name and input message.
- Tools that must be called and tools that must never be called.
- Sample responses for tool calls, including simulated errors.
- An optional rubric describing response quality.

Choose an accessible agent and a saved version, or evaluate the draft instructions
currently in the editor. Click **Run** for one case or **Run suite** for all cases.
The evaluator uses the selected agent's instructions, rules, enabled tool schemas,
and configured model. Tools return only the case's sample responses: they never read
or change real workspace data, call integrations, or generate images.

Results distinguish passed, failed, and inconclusive tool assertions. An unavailable
or forbidden call fails. A call missing a sample response is inconclusive unless
another assertion already failed. Cases without tool assertions are inconclusive.
Expand a result to inspect its response, attempted calls, captured instructions and
case, model, cost, and time.

**Judge cases with a rubric** adds a separate model call for each rubric. Its score
and rationale appear alongside the deterministic tool assertions. If judging fails,
the tool assertions remain available.

For an improvement draft, **Compare active version and draft** runs the same cases
against both targets and shows them side by side. Each request captures the case and
configuration at that moment. Later edits do not rewrite results. Passing an
evaluation never saves a draft or changes the active version; that remains a separate
builder decision.

## Memory and observations

Personal memory belongs to the member and is shared across the agents they use.
Manage it under **Settings > AI**. Channels and sessions have their own audiences;
organization memory can apply to all agents or a particular agent. Agents only recall
memory available to the requesting person in that conversation.

Builders manage organization memory under an agent's **Memory** panel. Memory is
context, not authority to override rules or permissions.

A skill's **Observations** section reports real invocation outcomes, tool errors,
duration, tokens, and costs by exact version. Completion means the run finished; it
does not grade the answer. Behavioral evaluations provide a separate, explicit check.

## Hosted and self-hosted operation

Hosted and self-hosted deployments use the same organization-scoped provider settings,
permission checks, and budgets. An organization admin configures keys and the default
model in **Admin > Agents**. Keys are encrypted at rest.

Editing agents, rules, skills, and evaluation cases makes no model calls. Generation
and evaluation require an explicit action and a configured provider. Without a
provider, those requests report that configuration is required. Without the job
service, requests report an unavailable or interrupted run. Recovery never silently
repeats paid generation or evaluation; request a retry or new run explicitly.

Self-hosted installations can keep these AI actions unused and run air-gapped. The
bundled rule and skill libraries remain available locally.

## Troubleshooting

| Problem | What to check |
|---|---|
| An agent is missing from Chat | Its sharing policy, retirement state, and the organization's Agents in chat setting |
| An agent cannot answer | An enabled, valid provider key, a configured model, available budget, and running services |
| A skill is missing from the slash menu | Its assignment, active version, required tools, and supported surface |
| A referenced note is inaccessible | Your current permission to view that note |
| Generation or evaluation could not finish | The displayed reason; retry explicitly once the provider, budget, or job service is available |
| A case is inconclusive | Missing sample responses, missing tool assertions, or an incomplete model response |
| An evaluation result differs from current edits | Results retain the case and instructions captured when requested; run again to evaluate current changes |

See [Sharing](SHARING.md) for content permissions and [Searching](SEARCHING.md) for
workspace search and mentions.
