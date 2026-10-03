---
title: Exporting projects
description: Take your tasks out of Uniffy as a CSV file. One project or many, the whole thing or exactly what a view shows, with sprints, activity and comments when you want them.
sidebar:
  order: 6
---

Your project data is yours, and you can take all of it with you at any time.

An export is a CSV file that opens in any spreadsheet. Every task is a row, subtasks included. Every field is a column, including the custom fields you added yourself.

## What goes in the file

Each row carries the task key, title, type, status, priority, assignees, creator, dates, estimates, sprint, parent, blockers and tags. Then comes one column for every custom field, named `field:` followed by the field name.

Values come out the way you read them in the app. A status reads **In Progress**, never an internal id. People are listed by email and groups by name. Timestamps are in UTC.

A private group you are not a member of is listed by its id. Uniffy never tells you its name in an export when it would not tell you in the app.

Subtasks keep their place in the tree. Each one names its parent key and how deep it sits, so you can rebuild the hierarchy in a spreadsheet with a filter.

## A view or the whole project

Exporting the current view gives you the rows that view shows. Its filter applies, its sort applies, and an outline table keeps each task's subtasks right under it. Grouping and the quick search box do not carry over. The group is still a column, so a pivot gets it back.

Exporting the whole project gives you every task, in the project's own order. Nothing is filtered out.

From the portfolio you can select several projects and export them into one file. Every project contributes its whole task list. A custom field that only one project has is still one column, left empty for the others.

## The bundle

Tick the bundle option and you get a zip instead of a single file. Next to the tasks it holds the sprints, the full activity history, every comment, and the field definitions with their options.

The files are read at the same moment. A comment in the bundle always belongs to a task in the same bundle, even when someone keeps working while the download runs.

## Limits and who can export

You can export any project you can open, and nothing else. Being an organization admin does not change that. If a single project in your selection is not yours to see, the whole export is refused and nothing downloads.

An export is capped at 200,000 tasks. If you ask for more you are told before anything downloads, so you can narrow the filter or pick fewer projects.

Every export shows up in your organization's [audit log](/docs/administration/security/audit-log/) as **Exported**, once for each project in it.

A spreadsheet will run a cell that starts with an equals sign as a formula. Uniffy puts a quote mark in front of any text that would trigger that, so a task titled `=SUM()` stays a title when you open the file.

If you are evaluating where your work will live, ask every tool the same thing: can I get all of it back out, today, without asking anyone?
