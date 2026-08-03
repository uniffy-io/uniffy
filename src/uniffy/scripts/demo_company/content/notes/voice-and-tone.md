---
title: Voice and Tone
slug: uniffy-voice-and-tone
folder: Handbook/Brand Book
tags:
  - brand
---

# Voice and Tone

## The voice

Plain, warm, exact. We write the way a good engineer explains an outage: short
sentences, no jargon unless the jargon is the point, and always a next step.

Bulgarian and English versions are both first-class. Neither is a translation of the
other; both are written from the same brief so each reads naturally.

## Tone by situation

| Situation | Tone |
| --- | --- |
| Release notes | Brief, concrete, one screenshot per change |
| Support reply | Warm, specific, no drama |
| Incident status update | Calm, factual, always with a time for the next update |
| Billing | Neutral, itemised, no euphemism |
| Post-incident review | Direct, what happened, what we are changing, when |

## Rules that survive review

- Say the number. "Search latency rose to 900 ms for 14 minutes" beats "briefly degraded".
- Never deliver bad news without a route to a human. Every incident mail carries the
  status page link and a reply address a person reads.
- No diminutives for problems. It is an outage, not a hiccup.
- Avoid "simply", "just", "obviously". If it were obvious the customer would not be reading.
- Times in 24-hour format with the zone stated: 14:30 EEST.
- Money in EUR, with BGN in brackets when the audience is Bulgarian.

## Examples

Weak: "Unfortunately some users may have experienced degraded performance due to
unforeseen circumstances."

Better: "Between 09:12 and 09:47 EEST, message delivery on cloud.uniffy.io was delayed
by up to four minutes. Nothing was lost. The fix is deployed, and we will publish the
review by Friday."

Technical accuracy still outranks tone. When the two conflict, ask the SRE lead.
Communication that carries an uptime or security claim follows
[Brand Foundations](brand-foundations.md).
