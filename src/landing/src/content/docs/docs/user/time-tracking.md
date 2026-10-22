---
title: Time tracking on projects
description: Log time on tasks, run one timer, review your week in My time, and submit periods for approval when your organization turns approvals on.
sidebar:
  label: Time tracking
  order: 7
---

Time in Uniffy is a record of what a person did, not a column someone types into a task. Every minute on a task is an **entry** with an owner, a day and a duration, and the task's time spent is always the sum of its entries.

## Entries

You log time on any task you can open. Type a duration the way you would say it: `1.5h`, `1h 30m`, `45m` or a plain number of minutes. Pick the day, add a line about what the time went on, and the task total moves right away.

An entry belongs to the person whose time it is. You can change and delete your own. A day holds at most 24 hours per person, and the organization decides how far back you may still edit and whether future days are allowed.

Your manager and your team leads can log time on your behalf. The entry says who wrote it, the task's activity says the same, and nothing about that grants them a way into tasks they could not open before. An organization can switch logging for others off entirely.

Deleting a task removes its entries from every total. Deleting an entry is final too, so Uniffy asks before it does either.

## The timer

You run one timer at a time. Start it from a task, pause it over lunch, and stop it when you are done. The stop writes an entry on the day you started, rounded the way your organization chose.

Start a timer on another task and the running one stops into an entry first. Forget a timer overnight and it pauses itself once it passes the organization's limit, so a timer never books a whole weekend to a task by accident.

## My time

My time is your week on one page: a row per task, a column per day, and the total at the bottom of each column against the hours your organization expects. Days under that number read as a warning, days that meet it read as done, and holidays and weekends expect nothing.

The rail beside the grid lists the tasks you worked on recently so you can fill a day without searching. Copy last week brings the same tasks into an empty week with no minutes, which is usually most of the typing.

## Time on a project

Every project has a Time page for anyone who can open the project. Pick a range, group by person, task or day, and read the totals in a chart and a table. A task's estimate sits beside what was logged, so a project lead sees where the plan and the record drift apart.

The page reports time on work you can already see. It does not reveal a person's time on projects you cannot open.

## Periods and approvals

Approvals are off by default. Turn them on from the Projects admin page and every person's time falls into **periods**, a week or a month at a time.

When a period is done you **submit** it. If your organization locks on submit, your entries in that period freeze until a reviewer answers. You can **recall** a submitted period yourself as long as nobody has reviewed it yet.

Your reviewers are your manager from the people directory and the lead of every team you belong to. A person with neither is reviewed by the organization admins. A reviewer **approves** or **rejects** with a reason, and you get a notification either way. Editing an approved period sends it back for review, with the edit on the record.

A period that ended a while ago locks on its own, and the organization chooses how many days of slack come first. If you missed it, a reviewer can grant **grace**: the period opens for a number of hours, you fix the entries, and you submit again. Admins can also close a period for everyone, which locks every person's time in it, and reopen it later.

Auto submit hands in whatever was logged once the slack runs out, and reminders tell people with an open period and their reviewers with waiting periods. Both are switches on the same admin page.

## Agents

Ask an agent to log time and it writes an entry for you, on a task you can open, as you. An agent never logs time for anyone else, whatever the prompt says.

## Cloud and self hosted

All of this runs the same way on `cloud.uniffy.io` and on your own hardware. The policy, the periods and the approvals live with your organization's settings, and nothing here calls home.

When you compare time tracking tools, ask one question first: is a person's time a record they own, with a reviewer and a trail, or a number anyone with edit rights can overwrite?
