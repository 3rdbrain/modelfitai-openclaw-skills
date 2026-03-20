---
name: health-reporter
description: Generate daily VPS health reports — disk usage, memory, load average, and container status — delivered via Telegram with actionable recommendations.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, docker, health, reporting, vps, monitoring, telegram]
requires:
  env: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID]
---

# Health Reporter Skill

Report VPS health metrics to the platform and provide local summaries.

## Available Commands

Run with Node.js: `node {baseDir}/health-reporter.js <command>`

- **report** — Collect full health snapshot and POST to Supabase API
- **summary** — Print a local health summary (no network call)
- **containers** — List all openclaw containers with status, tier, and age

## Usage

```bash
node {baseDir}/health-reporter.js report
node {baseDir}/health-reporter.js summary
node {baseDir}/health-reporter.js containers
```

## What Gets Reported

| Metric | Description |
|---|---|
| container_count | Total running openclaw containers |
| cpu_usage_percent | Host CPU usage |
| memory_used_mb | Host memory used |
| disk_used_percent | Host disk usage |
| uptime_seconds | VPS uptime |
| anomaly_count | Containers with issues detected |
| last_update | Last security update timestamp |
| network_rules_ok | Whether iptables isolation is intact |

## Environment Variables

- `TELEGRAM_BOT_TOKEN` — Telegram bot token for daily reports
- `TELEGRAM_CHAT_ID` — Telegram chat ID to deliver reports to
