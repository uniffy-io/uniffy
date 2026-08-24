---
title: Agents
description: Turn agents on for your organization, hold the provider keys, set the default model, and cap what agents are allowed to spend.
sidebar:
  order: 1
---

Agents are the one part of Uniffy that spends money every time someone uses it, so this page is mostly about control. Keys, defaults, and caps. What agents are allowed to read is not configured here, because it is not configurable at all.

## Nothing runs without a key

Uniffy holds no model credentials of its own. Your organization adds its own key for Anthropic, OpenAI, Google, OpenRouter or xAI, and every agent run bills to that key. Your billing relationship stays with the model provider.

Only org admins add, remove, enable, disable or revalidate a key. A key is encrypted at rest with a key that belongs to your organization, never a shared one, and the decrypted value never leaves the process that calls the provider.

There is no format check on a key, because providers change key shapes without telling anyone. Instead Uniffy calls the provider the moment you add it and stores the answer. A rejected key is still saved so you can fix it, with the provider's own error text attached. That error text is admin only. Other members see a masked hint of the key and whether it currently works, and nothing else.

Keys carry no sharing settings. Every enabled key is usable by every member of the organization, which is deliberate: rationing happens through budgets and rate limits, where you can actually see and audit it, not through hiding a key from some people.

## Availability

One switch decides whether agents exist in chat at all. Turn it off and agents vanish from the pickers and stop answering. Everything else about chat is untouched, and turning it back on restores the conversations exactly as they were.

## The default model

Set a default provider key and a default chat model and someone can create an agent by typing a name. The run falls back to these when the agent has none of its own.

The default key must be enabled and valid, and the default model has to be one that key's provider actually serves. Uniffy refuses the pairing otherwise rather than failing later at send time. If the default key is later deleted or disabled, agents that were relying on it stop running and the page tells you so.

## Runtime behavior

The Runtime tab holds the knobs that decide how a run behaves when things go wrong.

**Provider failover** retries a failed run against the agent's fallback models instead of handing the member an error. **Resume interrupted runs** lets a browser reconnect to a run that was still going when the page reloaded, so a refresh does not lose an answer.

The **circuit breaker** stops hammering a provider that is down. After a set number of failures it stops routing to that key, waits, then probes again. Defaults are five failures and sixty seconds.

The **send deadline** is the wall clock budget for a single run, five minutes by default. A run that exceeds it is abandoned rather than left hanging.

Two ceilings cap image generation for every agent in the organization, one on output size and one on rendering effort. They clamp rather than reject, so lowering a ceiling never breaks an agent that was configured under the old one. It applies to what the model asks for too, so a member asking for a huge image gets your ceiling instead of a bill.

The **personal memory bridge** is a two key switch. A member can opt in to letting their own memory be readable by agents in shared conversations they start, and this setting decides whether that opt in counts at all. Off here means off for the whole organization, whatever individuals chose. It only ever widens reading, never writing.

## Budgets

A budget caps spend for the whole organization in a billing period. Set the amount, the currency, and which day of the month the period resets on. Set a separate cap on image generations, which are priced very differently from text.

A **hard limit** rejects requests once the cap is reached. A soft limit logs and proceeds. Pick deliberately: hard means an agent stops answering mid month, and members will feel that.

Alert thresholds fire notifications on the way up, at fifty, seventy five and ninety percent by default, so nobody discovers the cap by hitting it.

## Per member quotas

A quota narrows one member below the organization's budget. Daily and monthly spend, daily and monthly image counts, each optional, each with its own soft or hard behavior. You set them from the member's row on the Members page or from this section.

When no quota row exists, image generation still has a floor of protection: twenty images per person per day and five hundred per organization per month. Text has no default spend cap.

## Rate limits

Budgets cap money over a month. Rate limits cap bursts over a minute, which is what actually protects you from a loop or a bad automation.

Five buckets exist, and each one falls back to a server default until you override it: messages per member, messages per organization, messages per agent, and image generations per member and per organization. The defaults are thirty messages a minute per member, two hundred per organization, sixty per agent, and five and twenty image generations respectively.

## Currency

Providers bill in dollars. Pick the currency you want to read spend in, and enter the exchange rates you want used. Rates are yours to set, not fetched from anywhere, so a self hosted deployment with no outbound internet reports spend the same way as a cloud one.

## Usage

The Usage tab is the org wide view: tokens over time, tool calls, which agents are being used, how traffic splits across models, and what each provider key is costing you. Members see the same view scoped to themselves under their own settings.

The Skills tab reports which skills are actually earning their place. For each one you get how often it was injected into a prompt, how often an agent opened it, and how often a member invoked it by hand. A skill that is always injected and never used is costing you tokens on every message.

## What you cannot configure here

There is no setting that lets an agent read more than the person talking to it. Org admins do not get one, domain admins do not get one, and there is no override to enable. Every tool call an agent makes runs the same permission check the member would hit clicking through the app.

That is why this page has no access controls on it. If you want an agent to see less, give it fewer tools, which is covered in [Building agents](/docs/administration/workspace/building-agents/). If you want it to see more, share the content with the person asking.
