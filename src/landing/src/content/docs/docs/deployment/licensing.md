---
title: Licensing
description: How Uniffy licensing works. Free for 10 users, one license for every line, offline license keys, seats as the only thing a key changes.
sidebar:
  label: Licensing
  order: 3
---

Uniffy is free to run on your own hardware for up to 10 users, full product, forever. This page explains what happens past 10, what a license key changes, and what it can never change.

If you are a cloud tenant, you will never see a license key. Plans on `cloud.uniffy.io` are billing. License keys exist for self hosted deployments only.

## One product, one license

Every line of Uniffy ships under one source available license based on the Business Source License. The backend, the browser app, the mobile app, and the command line tool all carry the same license text. There is no open core split, no enterprise directory with a different header, no private repository for paying customers.

On 2039-01-01 the license converts to Apache 2.0. That date is written into the license text itself, so we cannot take it back. If Uniffy the company disappears, the code opens.

Source available means you can read every line, audit it, run it yourself, and modify it for your own use. It is not an open source license in the OSI sense, and we will not pretend otherwise. The two things it does not allow are running Uniffy for more users than your grant covers and selling Uniffy as a hosted service to third parties.

## What is free

Production use for up to 10 **active users**, with every feature the product has. This is not a trial and not a "Community Edition". It is the same build paying customers run.

A five person startup installs Uniffy on a single server and never thinks about licensing again.

A fifty person company runs a pilot with eight people from one team. Still free, for as long as the pilot stays at ten or fewer active users.

That same company rolls Uniffy out to everyone. Now it needs a license key for fifty seats.

## What a license key changes

One number: how many users can be active at the same time. Nothing else.

Licensed and unlicensed deployments run identical code. There is no feature that appears when a key is present. If you diff a licensed deployment against a free one, the only difference you will find is the seat count shown on the admin pages.

## What counts as a seat

A **seat** is one active user account, counted across the whole deployment. If your deployment hosts several organizations, the count is the sum over all of them, not per organization.

Deactivating a user frees the seat immediately. Someone leaves the company, an admin deactivates the account, and the seat is available again the same second. Deactivated accounts keep their data and can be reactivated later, they just do not count while inactive.

## How the key works

A license key is a short signed text block. You paste it into the admin pages, or point the deployment at it with the `UNIFFY_LICENSE` environment variable. The deployment verifies the signature offline against public keys that ship inside the product.

There is no license server. Your instance never calls us to validate anything. Not on install, not daily, not ever. A deployment with no outbound route to the internet is a fully supported configuration, free or paid, with zero exceptions.

## Renewals, and what happens when a license lapses

A license covers every Uniffy release published before its end date, and it covers those releases forever. The check compares the license date against the release date of the build you are running, never against the clock on the wall.

You buy a license in March. Every release we publish for the next year is yours. The license lapses the following March and you decide not to renew. The last covered release keeps running, fully licensed, for as long as you want to run it. What you give up is newer releases. Renewing buys another year of them.

Trial keys are the one exception. A trial expires on a calendar date, and then the deployment falls back to the free tier rules.

## What happens when you outgrow your seats

On the free tier, activating an eleventh user is blocked with a clear message, and the admin pages show where you stand. Everyone already active keeps working. Nothing is hidden, nothing is deleted, nobody is logged out.

On a paid license, you get a 10 percent buffer above your seat count. Grow into the buffer and the admin pages show a banner, and the overage is settled at renewal. Growth past the buffer is blocked until the license is upsized.

If you restore a backup and land over your entitlement, the same rules apply. A banner, blocked growth, and nothing else.

We will never lock you out of your own data. Not for an expired license, not for too many seats, not for anything. Enforcement gates growth, never access.

## Buying a license

Licenses are sold per seat, per year. Trial keys with unlimited seats are available if you want to evaluate at full size first. See [pricing](/#pricing) or [contact us](/contact).

When you compare us to another vendor, ask them one question: if I stop paying, what exactly stops working? Our answer fits in one line. New seats stop, everything else keeps running.
