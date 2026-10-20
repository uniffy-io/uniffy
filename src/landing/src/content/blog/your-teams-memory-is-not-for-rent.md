---
title: "Your team's memory is not for rent"
description: "A note for anyone who has watched a renewal quote climb after their team's history moved into a tool. Why the workspace is the one thing you should own, and what we did about it."
publishedAt: 2026-10-20
author: team
tags: [Company, Open source]
draft: false
---

Your team's workspace is the one piece of software you should never rent from someone who can change the terms on you.

We know how that sounds coming from people who make a workspace. Stay with us, because this is less a pitch than a thing we kept running into, and it is the reason Uniffy exists at all.

Think about what actually lives in your workspace. Not the data, the reasoning.

The note where someone explained why you went with one architecture over another. The thread where a customer problem got figured out at eleven at night. The doc a colleague wrote the week before they left, which turned out to be the only place that process was written down. The calendar that shows who was in the room when the call got made.

A billing system holds transactions and a customer database holds contacts. You can export those, load them somewhere else, and the business carries on. The workspace holds something harder to move. Lose it and your team keeps working, but it starts repeating its own mistakes.

## You probably know the feeling

Here is how it usually goes.

Year one, you pick a suite because it is convenient, and it is. Chat, docs, files, and calendar all wired together, a login that works on day one, somebody else carrying the pager. Nothing wrong with wanting that. Most teams are right to want it.

Year three, everything is in there. Onboarding, incident history, every design argument you ever had. Then the renewal lands. New tier, new per seat price, and a very polite account manager who knows exactly how much of your company lives inside their product.

If that sounds familiar, you are not imagining it. Zylo, which tracks software spend for large companies, found that [nearly four in five IT leaders met a price increase at renewal last year](https://zylo.com/blog/saas-statistics).

That is not a market where you hold the cards. The price did not go up because the product got better. It went up because leaving got expensive.

And when you finally decide to leave, the export is a zip file of HTML pages with the links pointing back at the vendor's domain. It got bad enough that the European Union wrote [a law](https://eur-lex.europa.eu/eli/reg/2023/2854/oj) ordering cloud vendors to remove the obstacles to switching. Laws like that do not get written because the door was already open.

## Then the AI arrived

This part is newer, and it bothers us more.

One Monday the assistant is there. Switched on for everyone, reading everything the suite can see, running on a model you did not pick, under terms you did not read. It summarizes channels and drafts from documents, and it is honestly pretty useful.

Nobody on your side decided whether it should see the finance folder. Nobody asked where the prompts go. And six months later the version that is actually good moves to the plan above yours.

The pattern is the same as the pricing one. The feature arrives inside software you already pay for, so you never got to evaluate it as a choice. It is just there, with the vendor's reach instead of yours.

## Open source is not automatically the way out

The obvious answer is to run something open source yourself. Own the data, read the code, nobody can change the terms. We agree. That is the whole idea.

But a lot of what gets called open source in this category is open core. The code on GitHub is a "Community Edition". It installs fine and it demos well.

Then you try to roll it out to a real organization and find out what is missing. Single sign on is in the paid build. So is the audit log. So is everything a security review asks about on day one.

> Open core is closed source with a free trial.

The "Community Edition" is not a product. It is a funnel.

You carry the burden of self hosting. Your data now sits in a shape only that software reads. The moment you need it to behave like something a company can rely on, you are back with a vendor who can change the terms. You traded one landlord for another, and this one makes you mow the lawn.

## What we decided

We built Uniffy as one product with one codebase. Whether you run it on `cloud.uniffy.io` or on your own servers, it is the same build, the same features, the same admin pages. There is no "Community Edition", no enterprise edition, no private fork for people who pay, and nothing waiting behind a higher tier. The [principles page](/docs/principles/) is the long version, and we mean every line of it.

Self hosting is free, for any number of people, forever. The license lets you read every line, run it in production at any size, and change it. Two years after each release, that code becomes plain Apache 2.0 no matter what happens to us. We call that open source.

Purists will point out the license is not on the OSI list, because of one restriction: you cannot sell Uniffy as a competing service. The [licensing page](/docs/deployment/licensing/) has the whole story. Read it and decide for yourself.

AI is off until your organization turns it on, and when you do, you pick the provider and bring your own keys. An agent only ever acts with the permissions of the person asking it. If you cannot open the finance folder, neither can the assistant. We think that is the only sane way to put AI inside a workspace.

The door out stays open. Your instance never calls us. Notes are Markdown, files are files, and nothing sits in a shape only we can read.

On our cloud we host your data and we cannot read it, not as a policy but as a mechanism. There is no back door for our operators. The only way into a tenant is a **support session** you approve, watch live, and can revoke at any moment. Run it yourself and the question never even comes up.

All of this has a cost on our side. One codebase for cloud and self hosted means two admin surfaces. One belongs to your organization and one to whoever runs the deployment. On your own servers you wear both hats.

It is more complex than a single admin page. We chose it anyway, because the alternative is a fork, and a fork is how "Community Editions" are born.

## The question to take to any vendor

Every workspace vendor will tell you your data is yours. Fine. Then ask the next question. Who can change the terms on it, and what does it cost you to say no?

If the honest answer is "we can, and leaving costs you your history", you are not a customer. You are a tenant with a lease you did not read. Your team's memory deserves a better landlord than that. Or, better, none at all.
