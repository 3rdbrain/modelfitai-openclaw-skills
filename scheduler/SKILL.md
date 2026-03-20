---
name: scheduler
description: Cron-based task scheduler for OpenClaw agents — run skills on a schedule, manage recurring jobs, and persist schedules across restarts.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, scheduler, cron, automation, recurring]
requires: {}
---

# Post Scheduler Skill

Schedule posts for future publishing via the ModelFitAI scheduler pipeline.

## Available Tools

Run with Node.js: `node {baseDir}/scheduler.js <command> [args]`

- **schedule** — Schedule a post for a future time
- **list** — List all scheduled posts
- **cancel** — Cancel a scheduled post
- **status** — Check scheduler status

## Usage

```bash
node {baseDir}/scheduler.js schedule --platform x --text "Your tweet" --time "2024-01-15T10:00:00Z"
node {baseDir}/scheduler.js list
node {baseDir}/scheduler.js cancel <post_id>
```
