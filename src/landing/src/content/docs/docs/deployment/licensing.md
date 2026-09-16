---
title: Licensing
description: How Uniffy licensing works. Open source under the Functional Source License, free to self host with no user limit, and every release becomes Apache 2.0 after two years.
sidebar:
  label: Licensing
  order: 12
---

Uniffy is open source and free to run on your own hardware. Full product, any number of users, forever. This page explains the one thing the license does not allow, and the date on which each release becomes plain Apache 2.0.

If you are a cloud tenant, none of this applies to you. Plans on `cloud.uniffy.io` are billing for a service we host. The license governs the code, and the code is free to run. The [FAQ](/faq) covers the short versions of the questions this page answers in full.

## One product, one license

Every line of Uniffy ships under the Functional Source License, FSL-1.1-Apache-2.0. The backend, the browser app, the mobile app, and the command line tool all carry the same license text. There is no open core split, no enterprise directory with a different header, no private repository for paying customers.

We call Uniffy open source because the rights that matter are yours. Read every line. Run it in production at any size. Modify it. Redistribute your changes. Purists will point out that the FSL is not on the OSI's approved list, because of the single restriction below. Fair point. Read the restriction and judge for yourself. And note that it expires: two years after each release, nothing but Apache 2.0 remains.

## Every release becomes Apache 2.0

Two years after we publish a release, that release converts to the Apache License 2.0. This is not a promise in a blog post. It is an irrevocable grant written into the license text itself. If Uniffy the company disappears, the code opens on schedule anyway.

The conversion runs per release. A version published in August 2026 becomes Apache 2.0 in August 2028. The version published next month follows two years behind it. At any moment, everything older than two years is plain open source.

## What is free

Production use, for any organization, at any size. Self host Uniffy for 5 people or 5,000 and you owe us nothing.

There is no "Community Edition" and no trial. The build you run free is the build our paying cloud customers run.

A five person startup installs Uniffy on one server and never thinks about licensing again.

A two thousand person company rolls Uniffy out to everyone on their own Kubernetes. Still free. They might buy a support contract. They do not need a license.

## The one thing you cannot do

You cannot sell Uniffy as Uniffy. The license bars a **competing use**: offering Uniffy, or a product that substitutes for it, to third parties as a commercial product or service. Hosting Uniffy for your customers and charging them for it is the thing this license exists to prevent.

Everything else stands. Run it internally at any scale. Modify it for your own use. A consultancy can charge you for installing, operating, and customizing your Uniffy. The license explicitly permits professional services, and we think a healthy market of people who help you run Uniffy is good for everyone.

## How we make money

Two ways, and only two.

We run `cloud.uniffy.io` for teams that do not want to operate servers. Free for up to 10 users, paid above that. You are paying for hosting, storage, backups, and the service levels on the pricing page. Never for features.

We sell support for self hosted deployments. Upgrade help, incident response, a human who knows the codebase on the other end of a ticket. Three subscriptions, priced per deployment per year, on the [pricing page](/#pricing). The software stays free either way.

When you compare us to another vendor, ask them two questions. Can I run the full product myself, free, at any size? And what happens to the code if you disappear? Our answers are yes, and it becomes Apache 2.0 on a date already written into the license.
