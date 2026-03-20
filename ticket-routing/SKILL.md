---
name: ticket-routing
description: Auto-categorize customer support tickets by priority and sentiment, route to the right queue, and manage resolution status.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, customer-support, tickets, routing, helpdesk]
requires: {}
---

# Ticket Routing Skill

Manage customer support ticket routing and categorization.

## Available Tools

Run with Node.js: `node {baseDir}/ticket-routing.js <command> [args]`

- **route** — Route a ticket to the appropriate queue
- **categorize** — Auto-categorize a support issue
- **list** — List open tickets
- **resolve** — Mark a ticket as resolved

## Usage

```bash
node {baseDir}/ticket-routing.js route "User can't login" --priority high
node {baseDir}/ticket-routing.js list --status open
node {baseDir}/ticket-routing.js resolve <ticket_id>
```
