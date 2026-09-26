# Contributing

Two things to know before you spend time here: we are not taking pull requests yet, and a well written issue is the most valuable thing you can send us.

## We are not taking external pull requests yet

All code is written in house right now. This is a timing decision, not a permanent policy. We are a small team building toward the cloud launch, and reviewing outside patches properly against a permission model that is still moving under our feet would be worse than not reviewing them at all.

Once cloud ships, we intend to open this up.

## What actually helps

Issues. A well written issue tells us about a problem we did not know we had, and that is worth more than a patch.

Pick the template that fits: **Bug**, **Feature**, **Performance**, or **Security**. Blank issues are off on purpose. **Exploitable vulnerabilities never go in an issue.** Read [SECURITY.md](SECURITY.md) and use a private channel.

An issue we can act on says which deployment (`cloud.uniffy.io` or self hosted), what you expected and what happened instead, and the smallest sequence that reproduces it. For performance, give us a number. For anything visual, a screenshot beats a paragraph.

Pasting a diff or snippet into an issue is welcome when it makes the report clearer. To keep that simple for everyone: **anything submitted through an issue is licensed to Uniffy Labs for any use, without restriction or attribution.** If you are not comfortable with that, describe the fix in prose and we will write it ourselves.

## Running it yourself

Everything goes through `./manage.py`, a self contained uv script. The full command surface lives in [AGENTS.md](AGENTS.md), and production guidance in the [deployment docs](https://uniffy.io/docs/deployment/).

```bash
./manage.py start          # full containerized stack
./manage.py logs           # tail everything
./manage.py test           # backend and frontend suites
./manage.py lint           # ruff, oxlint, oxfmt
```

## Conduct

Be straight with people and assume they are doing their best. Blunt technical feedback is fine. Personal attacks, harassment, and bad faith are not, and we will lock a thread over them without a lengthy process.

## Everything else

Email admins@uniffy.io. Deployment questions, architecture questions, "is this supposed to work like this". If a question turns out to be a bug, we will ask you to file it so it does not get lost in a mailbox.
