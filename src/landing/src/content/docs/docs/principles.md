---
title: Principles
description: The rules we built Uniffy around. One codebase for cloud and self hosted, no analytics, no surveillance, no telemetry, AI on your terms.
sidebar:
  label: Principles
  order: 1
---

We built Uniffy around a few rules that we will not bend on. Every feature in the product has to satisfy all of them. This page walks through what they are and why we picked them. Read it before you compare Uniffy to anything else. The real differences usually live here, not in the feature list.

Each principle below is collapsed. Click a title to read it.



<details class="principle">
<summary>One codebase, one product</summary>

Cloud and self hosted ship from the same commit. There is no "Community Edition" with features stripped out. No enterprise tier. No private fork that only paying customers get. The instance running at `cloud.uniffy.io` is exactly the code you can pull from GitHub and run on your own servers.

Two things follow from that.

You can audit the code that processes your data. There is no closed binary in the loop, anywhere.

Features cannot quietly drift from open to closed. Whatever ships goes into the public tree the same day. If we ever change our minds, you will see the commit.

One concrete consequence shows up the moment you log in as an administrator. You will see two distinct surfaces, an org admin view for your tenant and a platform operator view for the deployment, even when you are the same person wearing both hats. That is more complex than one combined admin page, and we did it on purpose. The admin guide covers what lives on each surface.

</details>

<details class="principle">
<summary>No analytics, no trackers, no cookies</summary>

We do not measure what you do inside Uniffy. We do not record which pages you visit, which buttons you click, how long you spend on a note, or which agents you talk to. None of that data is generated, none of it is stored, none of it is sent anywhere. There is no event pipeline because there are no events.

We do not analyze the content of your workspace either. Your notes, your files, your chat messages are yours. We do not read them to improve search ranking. We do not feed them into any training pipeline of our own or anyone else's. We do not aggregate them into trends.

The app does not set cookies. None. No session cookie, no preference cookie, no tracking cookie, no consent banner because there is nothing to consent to. There are no third party scripts loaded into the front end that could drop their own. No Google Analytics. No Hotjar. No Sentry, no LogRocket, no Mixpanel, no Segment, no Facebook pixel. The browser tab that runs Uniffy looks the same to your network the first time you open it and the hundredth time.

If you are curious what we actually know about your usage, here is the full list. The fact that your account exists. The timestamp of your last login, so the product can show "last seen". Aggregate counts that fit on a billing page, like total storage used and number of agent runs this month. That is the entire list.

</details>

<details class="principle">
<summary>Not a surveillance tool</summary>

Uniffy is a place for your team to work. It is not a place for you to watch them work.

There is no location tracking on the mobile app. No productivity score. No active hours dashboard. No "focus time" report that ranks your team by how long they typed today. The product does not collect that data, does not surface it to admins, and does not expose it through any API.

Some workplace tools have grown a whole surveillance product alongside the real product. Microsoft 365 ships a Productivity Score that tells managers who is "active" and who is not. Other suites log every keystroke, every idle minute, every meeting a person attended. We will not build any of that. Not for cloud, not for self hosted, not as a paid add on, not behind a feature flag.

If you are evaluating Uniffy and you want or need this, **Uniffy is not for you**.

</details>

<details class="principle">
<summary>No telemetry, ever</summary>

The product does not send telemetry. We do not collect usage events. We do not collect crash reports. We do not pull fonts or assets from a CDN. Everything the app needs is bundled into it.

Self hosted Uniffy is free at any size. Your instance never calls us. Not on install, not once a day, not ever. A deployment with no outbound route to the internet is a fully supported configuration, not a special arrangement. The [licensing page](/docs/deployment/licensing/) in the deployment guide has the details.

If we ever ship an optional analytics opt in, it will be off by default and clearly labeled. If you cannot find the switch, the feature does not exist.

Every call Uniffy makes to the outside world, whether that is sending mail through your SMTP provider, talking to an AI model, or hitting a webhook target, goes through a dedicated **egress worker**. The main backend and the core worker never reach the wider internet directly. You can put them on a network with no outbound route at all. Only the egress worker needs outbound firewall rules. If your security team wants a single chokepoint to audit, log, or block outbound traffic, that is exactly what they get.

</details>

<details class="principle">
<summary>AI is your choice, not ours</summary>

Uniffy's AI is an **agent harness** for work. Agents read, write, schedule, and organize across the whole workspace, with your permissions and nobody else's. And the product ships with all of it switched off. No agent runs, no model gets called, no provider credentials live in the deployment unless an administrator has gone in and turned them on.

If your organization decides AI is not for you, you do nothing. The agents page sits empty. The compose box has no agent dropdown. No background job ever opens a connection to a model provider. The decision to bring AI into your workspace is yours to make, and yours to revoke at any time.

When you do turn AI on, you pick the provider and the keys. Anthropic, OpenAI, Google, or a self hosted Ollama or vLLM endpoint. Your keys, your billing relationship, your choice of where the prompts go. We do not pool tenants behind a shared key, and we never read what flows through.

The switch lives in the admin pages, not buried inside a personal setting. One person granting AI access to themselves is not enough. The org has to consciously opt in.

</details>

<details class="principle">
<summary>We cannot see your workspace, unless you let us</summary>

On cloud, we host your data but we do not get to read it. Being a platform administrator on our side does not let us into any tenant's notes, files, or messages. There is no master key we keep behind the scenes. There is no support back door.

The only way for us to see what is inside your organization is if you, the owner, hand us a temporary key. When our support team needs to look at something to help with an issue, we ask. The request shows up in your admin pages. You decide whether to approve it, what scope to allow, and for how long. You can revoke it at any moment. When the window closes, our access ends.

If you do not approve, we do not look. The incident gets solved on whatever signals do not require reading your workspace, which is usually plenty.

On self hosted, the question never comes up. The deployment is yours. There is no "us" who could ask.

</details>

## How to apply these when you are evaluating Uniffy

When you compare us to another tool, the right question is not "does feature X exist." The right question is "if I run this on my own hardware, do I get the same product?"

Most workspace tools answer no. They ship a stripped community edition and reserve the real product for their SaaS. Uniffy answers yes. The admin surface is more complex because of that choice, and we think it is the right tradeoff.
