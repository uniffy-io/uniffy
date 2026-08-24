---
title: Agents
description: What an agent can and cannot do on your behalf, how it borrows your access instead of holding its own, and how to work with one from chat.
sidebar:
  order: 3
---

An agent in Uniffy is someone you message in chat, and it can read exactly what you can read. Not one note more.

That sentence is the whole product decision. Everything below is what follows from it.

## Where you meet an agent

Agents live in chat, next to the people you already talk to. You can open a one to one conversation with one, where every message you send goes to it. You can also add one to a channel, and then it answers three ways: when you mention it, when you reply to something it said, and when you post inside a thread it started. It stays quiet otherwise, so a channel with an agent in it still reads like a channel.

There is no separate AI panel to learn and no second inbox to check. An agent shows up in the same sidebar, in the same search, and behind the same `@`.

An org admin can turn agents off for the whole organization. When that happens they disappear from the pickers and stop answering, and nothing else about chat changes.

## It borrows your access, it never holds its own

Every action an agent takes runs as you. When it reads a note, the same permission check runs that would run if you clicked the note yourself. When it creates a task, the task is created by you.

So an agent cannot become a way around sharing. If a file is private to a colleague, the agent tells you it cannot reach it instead of guessing at the contents. If you were just granted access to a project, the agent has it too, in the same instant. Nothing is cached ahead of the check, so a revoke lands immediately.

This also means two people asking the same agent the same question can correctly get different answers. That is not a bug. You are asking through your own eyes.

One carve out, stated plainly. When your organization connects an outside service, GitHub for example, the agent calls it with that connection's credential, not with anything of yours. Its reach there is whatever the connection can reach, and it is identical for every member who asks. The current GitHub tools only read.

## What an agent makes belongs to you

Anything an agent creates for you starts private. A note it writes, a folder it makes, a task it files. They land in your personal space and nobody else sees them until you share them.

If you want something visible to the whole organization, say so. Ask it to create the note in the organization space and it will. It does not make that call on your behalf.

## Destructive actions stop and ask

Some actions cannot be walked back, so they do not happen silently. Deleting a note, a file, a task, a project, a calendar event or a scheduled task, and cancelling a room booking, all pause and show you an approve or reject card naming the exact action. Nothing happens until you press one of them.

Everything else runs as asked. Reading, searching, creating, editing, and moving do not interrupt you.

## What it can actually do

An agent works your workspace through tools, and the tools are the same features you use. Notes, files, projects, tasks, calendar, rooms, people, search, and image generation. It can also read and write its own memory, pull up a skill, and set up a schedule for itself.

Whoever built the agent chose which of those it holds. An agent meant for meeting prep might carry calendar, rooms and people and nothing else, so it cannot wander into your files even when you are allowed to.

If your organization connects GitHub, agents can also read repositories, pull requests, issues, commits, checks and code search. Results come back as readable summaries with a line naming which connection they came from, never as raw API output.

## Skills

A skill is a short written procedure an agent can pull in. Uniffy ships four to start with: code reviewer, meeting summarizer, project manager, and technical writer. Your organization can write its own.

Type `/` in the composer to invoke one for a single message. Skills take no arguments on purpose. Everything you write after the command stays your own message, which keeps a skill from being turned into a way to inject instructions into the agent.

Some skills are always on for an agent. Those need no command.

## Memory

You have one memory store, and every agent you talk to shares it. Tell one agent you prefer metric units and the next one already knows. You manage it yourself under Settings, then Agents, where you can read every entry, edit it, pin the few that matter most, or delete any of it.

Your organization has its own memory, separate from yours and managed by the people who build agents. That is where facts about the company live.

Memory in a shared space belongs to that space. What an agent learns in a channel stays with the channel, not with you. If you want your own memory to travel into shared conversations you start, there is a single toggle in Settings, Agents that turns it on. It only ever widens what the agent can read, never what it writes about you.

## You can see the work

While an agent is answering you can watch it think, and you can watch it work. The thinking pane shows the reasoning the model exposed, with how long it took. The tool pane names every tool call, in order, with whether it succeeded, and refusals show up as refusals rather than being smoothed over in the reply.

Both panes are still there after a reload. The record of how an answer was reached does not evaporate when you close the tab.

## Tune one conversation without touching everyone else

You can change the model an agent uses for your conversation, and adjust its knobs, from the composer. That override belongs to that one conversation. The agent your colleagues talk to is unchanged.

Long conversations show a context meter. When it fills you can compact the history, which summarises the old part and keeps going, or reset it and start clean. Compaction also happens on its own in the background before you hit a wall.

## Scheduled runs

An agent can be put on a schedule, so a summary lands every Monday without anyone asking for it.

A scheduled run happens when nobody is there to approve anything, so it runs with the permissions of the person who owns the schedule and only theirs. Whoever rewrites the prompt becomes that person. This is deliberate: a schedule must never become a way to run something as a colleague with more access than you.

## Images

Agents can generate images when the organization has a key for a model that makes them. Ask in plain language, including for the shape you want, and it works out the rest.

Image generation costs real money, and the price swings by more than an order of magnitude with size and quality. So the image settings in the composer carry a price estimate next to each choice, and every image that comes back has a regenerate menu for trying another setting.

Your organization can cap size and quality. Asking for more than the cap quietly gets you the cap rather than an error, so nobody's request breaks and nobody runs up a surprise.

## Your own spend

Settings, then Agents, shows what you have spent this period and what you have generated. Your organization may also set a daily or monthly limit on you specifically. A soft limit warns, a hard limit stops.

## Retired agents

An agent that gets retired keeps its name and picture on every message it ever sent, so old conversations stay readable. Its direct chat goes read only rather than disappearing. Nothing you talked about is deleted along with it.

## The question to take elsewhere

Most workspaces let their assistant read the workspace. The question worth asking is narrower than "does it have AI". Ask what happens when a colleague shares a document with everyone except you, and then you ask the assistant about it. In Uniffy the answer is that it cannot read it either, and it will say so.
