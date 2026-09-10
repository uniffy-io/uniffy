---
title: Building agents
description: Who can build agents, what the four panels of an agent actually change, and how skills, memory and automations behave once you ship them to the organization.
sidebar:
  order: 2
---

Agents in Uniffy are organization property, not personal toys. One person builds an agent and everyone who is allowed to reach it talks to the same thing, with the same instructions and the same tools.

That is why building is gated and using is not.

## Who can build

Org owners, org admins, and anyone holding the agents domain admin grant. Everyone else does not see the builder in their sidebar at all.

The domain admin grant exists so you can hand agent building to the person who is actually good at it without making them an admin of your whole organization. It confers no content access whatsoever. An agents domain admin cannot read a colleague's private note, and neither can the agents they build.

Nothing in the builder answers a message until the organization has a working provider key. A banner says so, and links admins straight to where keys live.

## Start from a template or from nothing

Uniffy ships three agent templates: a navigator that finds things across the workspace, a creator that writes and generates images, and an organizer that schedules meetings and books rooms. Each one arrives with instructions, a sensible tool set, and skills already chosen.

A template is a starting point and nothing more. Once created, an agent is an ordinary agent with no link back, so editing it never fights a future update, and updating a template never rewrites what you shipped.

Creating a blank agent needs a name. Everything else can wait.

## The four panels

**Overview** is identity and model. The name and picture, the tags people search by, which model it runs on, which fallback models to try when the first one errors, and which model draws its images. Leave the model empty and it inherits the organization default, which is the point of setting that default.

**Instructions** is the one free text field that shapes behavior. Write the personality, the constraints, the house rules. It goes at the top of every prompt this agent ever runs. There is a preview of the fully assembled prompt underneath it, so you can see exactly what the model will read, including the skills and the memory index that get folded in.

If you would rather describe what you want than write a prompt, the AI Builder drawer does that conversationally and writes the instructions for you.

**Capabilities** decides what the agent can do at all. Tools come in groups that map to the product: notes, files, projects, tasks, calendar, rooms, people, search, memory, skills, scheduling, images. Enable a group and the agent can use it, subject to whatever the asking member is allowed to see.

This is the only real lever on reach. Permissions decide who sees what, tools decide what an agent even attempts. A meeting agent with calendar, rooms and people cannot browse files, even for a member who owns every file in the organization.

If your organization has connected GitHub, its tools show up here too, with a picker for which connection to use when you have more than one.

**Memory** shows the organization's own memory in two tiers: facts every agent should know, and facts only this agent should know. Members' personal memory is not here and cannot be. It belongs to them and lives in their own settings.

## Test before you ship

Every agent detail page has a test drawer. It runs the real agent with your real permissions, so what you see is what a member with your access would get.

Test conversations are marked as tests: memory writing is refused inside one, so a test never pollutes the organization's memory. Everything else is real, including the cost. Test runs count against your budget on purpose.

## Skills

A skill is a markdown procedure an agent can pull in when it is relevant, instead of you cramming every possible situation into the instructions.

Four skills ship with Uniffy and are read only: code reviewer, meeting summarizer, project manager, technical writer. They are shared across every organization and they update when Uniffy updates. A skill that gets retired keeps working for agents that already enabled it, so an upgrade never silently changes an agent's behavior.

Your own skills are yours to edit, and every edit is kept. The version history shows what changed, lets you compare any two versions, and lets you pin an older one as the live version when a rewrite turns out worse.

Per agent you choose which skills it can reach, and which of those are always on. Always on costs tokens on every single message, so reserve it for the ones that genuinely apply every time. The Skills tab under agent administration tells you which ones are pulling their weight.

## Skill drafts

Skills also arrive on their own. When a member gives an agent a thumbs down, and when an agent decides a procedure is worth keeping, a draft appears at the top of the Skills page, and the Skills entry in your sidebar carries a badge with the count waiting for review.

Anyone can raise a draft. Only builders can publish, edit or discard one, and everything published becomes an organization skill regardless of who proposed it. Drafts are capped per person and screened for instruction injection markers before a reviewer ever reads one, so drafts cannot be used to flood you or to smuggle text past you.

Treat drafts as feedback with a shape. A thumbs down that turns into a two line procedure is worth more than a bug report.

## Automations

An automation is an agent, a prompt, and a schedule. A Monday digest, a nightly triage pass, a weekly report.

The important part is whose permissions it runs with. A scheduled run has nobody to ask for approval, so it runs as the person who owns it, and only as them. When a builder rewrites someone else's automation prompt, ownership moves to the person who wrote it. Trigger now is refused to anyone but the owner.

This is a deliberate corner. Building agents is an administrative power, and administrative power must never turn into a way to execute a prompt as a colleague who can see more than you.

Automations are private to their owner by default, and listing them applies the same access check as any other content. Being able to reach an agent does not let you read the prompts other people have scheduled on it.

An automation that keeps failing stops itself after a run of consecutive failures rather than retrying forever. The run history for each one shows every execution, what it cost, and what went wrong.

## Sharing an agent

An agent is ordinary content. It has an owner, an access mode, and a member list, and it uses the same sharing dialog as a note. New agents are visible to the whole organization by default, which is usually what you want.

Restricting an agent restricts who can talk to it. It does not restrict what it can read, because that was never the agent's to decide.

## Retiring an agent

Deleting an agent retires it. The row stays forever, because it is also the name and face on every message the agent ever sent, and stripping that would gut conversations people still read.

Retiring fans out sensibly. Its schedules are disabled, its own memory tier is deleted, it disappears from search and from every picker, and its direct chats go read only. Things that belong to other people survive: the memories it wrote into shared spaces stay with the space that owns them, and its avatar and history stay intact.

Restoring brings it back exactly as it was, with the schedules still off. A restore must never quietly resume a job nobody asked for.

## What to get right first

The instructions are what people notice, but the tool set is what actually matters. An agent with the wrong personality is annoying. An agent with tools it never needed is a bigger surface than it had to be, on every run, for every member.

Start narrow. Add a group when someone asks for it.
