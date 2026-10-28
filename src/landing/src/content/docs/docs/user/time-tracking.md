---
title: Time tracking on projects
description: Log time on tasks, run one timer, review your week in My time, plan sprints against capacity, and submit periods for approval when your organization turns approvals on.
sidebar:
  label: Time tracking
  order: 7
---

Time in Uniffy is a record of what a person did, not a column someone types into a task. Every minute on a task is an **entry** with an owner, a day and a duration, and the task's time spent is always the sum of its entries.

## Entries

You log time on any task you can open, from the task itself or from the Log time button on My time, where you search for the task inside the dialog. Type a duration the way you would say it: `1.5h`, `1h 30m`, `45m` or a plain number of minutes. Pick the day, add a line about what the time went on, and the task total moves right away. Ctrl+Enter saves, and Log another keeps the dialog open for the next entry.

A start and an end time are optional. Pick a start and the end follows from the duration, or pick both and the duration follows. An entry with times sits on the calendar; one without only belongs to its day. Switch the dialog to Period to write the same entry on every day of a range, a week of training or leave in one go, skipping days that expect no hours unless you say otherwise.

An entry belongs to the person whose time it is. You can change and delete your own. A day holds at most 24 hours per person, and the organization decides how far back you may still edit and whether future days are allowed.

Your manager and your team leads can log time on your behalf. The entry says who wrote it, the task's activity says the same, and nothing about that grants them a way into tasks they could not open before. An organization can switch logging for others off entirely.

Moving a task to trash keeps its time entries in your personal totals and review history. Permanently deleting the task removes those entries. Deleting an individual entry removes its minutes from totals.

## The timer

You run one timer at a time. Start it from a task, pause it over lunch, and stop it when you are done. Stopping writes an entry on the selected day, rounded the way your organization chose. The stop dialog lets you adjust the duration and day. Its clock time stays tied to the original timer start.

Start a timer on another task and the running one stops into an entry first. Forget a timer overnight and it pauses itself once it passes the organization's limit, so a timer never books a whole weekend to a task by accident.

## My time

My time is your week on one page, in three views. Calendar lays the days out hour by hour: entries with a time sit as blocks you can drag to another slot or stretch, a click on free space starts an entry at that time, and a drag across the hours sets its length. List reads the week day by day with every entry and its times. Timesheet is the grid: a row per task, a column per day, a number in each cell.

Every view carries each day's total against the hours your organization expects. Days under that number read as a warning, days that meet it read as done, and holidays and weekends expect nothing.

The rail beside the grid suggests what the week probably held. Meetings from your own calendar appear with their day and length; one click opens the entry on the internal project's Meetings task with the title as the note, and a meeting you logged stops being offered. Tasks you finished this week and tasks you worked on recently are one click from a row. Copy last week brings the same tasks into an empty week with no minutes, which is usually most of the typing.

On the phone, My time opens from the clock in the Projects header: a strip of the week's days with their totals, the chosen day's entries, and a plus to add one on a task from this week, the internal project or a search. Tap an entry to change it, the bin to remove it.

## Time on a project

Every project has a Time page for anyone who can open the project. Pick a range, group by person, task or day, and read the totals in a chart and a table. A task's estimate sits beside what was logged, so a project lead sees where the plan and the record drift apart.

The page reports time on work you can already see. It does not reveal a person's time on projects you cannot open.

## Days off

A required day is a workday from your scheduling settings. Holidays the organization lists expect nothing, and so does a day you are out of office on your calendar. An out of office event that covers your whole working window makes the day off. One that covers at least half of it makes a half day, so the requirement halves. Those days read as off on My time, in the reviewer inbox and in the period total, from the same number.

## The internal project

An admin can create one Internal project for the organization. It is open to everyone and holds six standing tasks: Meetings, Vacation, Sick leave, Training, Support rotation and Admin. Its tasks are pinned first on My time, so the hours that belong to no project still have a home. The admin page creates it once and links to it after that.

## Sprint capacity

A sprint with dates shows what its people can give it. Capacity is the required minutes over each assignee's workdays inside the sprint, less their days off. The sprint card sets the estimates against that capacity and reads red once the plan asks for more than the team has, and it sets the logged time against it too. Open the card's meter for the same picture per person. A task shared by several people splits its estimate between them.

## Periods and approvals

Approvals are off by default. Turn them on from the Projects admin page and every person's time falls into **periods**, a week or a month at a time.

When a period is done you **submit** it. If your organization locks on submit, your entries in that period freeze until a reviewer answers. You can **recall** a submitted period yourself as long as nobody has reviewed it yet.

Your reviewers are your manager from the people directory and the lead of every team you belong to. A person with neither is reviewed by the organization admins. A reviewer **approves** or **rejects** with a reason, and you get a notification either way. Editing an approved period sends it back for review, with the edit on the record.

A period that ended a while ago locks on its own, and the organization chooses how many days of slack come first. If you missed it, a reviewer can grant **grace**: the period opens for a number of hours, you fix the entries, and you submit again. Admins can also close a period for everyone, which locks every person's time in it, and reopen it later.

Auto submit hands in whatever was logged once the slack runs out, and reminders tell people with an open period and their reviewers with waiting periods. Both are switches on the same admin page.

## Agents

Ask an agent to log time and it writes an entry for you, on a task you can open, as you. An agent never logs time for anyone else, whatever the prompt says.

Ask an agent how your week went and it sums your own entries, by task, day or project. Ask about a project and it answers only for projects you can open, with the same totals the project's Time page shows.

## Cloud and self hosted

All of this runs the same way on `cloud.uniffy.io` and on your own hardware. The policy, the periods and the approvals live with your organization's settings, and nothing here calls home.

When you compare time tracking tools, ask one question first: is a person's time a record they own, with a reviewer and a trail, or a number anyone with edit rights can overwrite?
