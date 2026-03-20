---
name: container-monitor
description: Monitor Docker containers for CPU spikes, memory pressure, and restart loops — sends Telegram alerts with deduplication and auto-recovers unhealthy containers.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, docker, monitoring, containers, vps, alerts, telegram]
requires:
  env: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID]
---

# Container Monitor Skill

Continuously scan all customer agent containers and detect security anomalies.

## Available Commands

Run with Node.js: `node {baseDir}/container-monitor.js <command> [--silent]`

- **scan** — Full anomaly scan: restarts, CPU, memory, connections (use --silent to only output if issues found)
- **stats** — Show live CPU/memory usage table for all openclaw containers
- **restarts** — List containers with abnormally high restart counts
- **connections** — Check outbound connections; reverse-resolves unknown IPs and tells you exactly how to allow them
- **audit** — Full security audit: capabilities, privileged flag, network mode, volume mounts
- **add-host `<hostname>`** — Add a hostname to the admin allowlist (`/etc/modelfitai/allowed-hosts.txt`)
- **list-hosts** — Print the full allowlist: built-in + admin-added + per-container customer lists

## Usage

```bash
node {baseDir}/container-monitor.js scan
node {baseDir}/container-monitor.js scan --silent
node {baseDir}/container-monitor.js stats
node {baseDir}/container-monitor.js audit
node {baseDir}/container-monitor.js connections
node {baseDir}/container-monitor.js add-host api.mycrm.com
node {baseDir}/container-monitor.js list-hosts
```

## Anomaly Thresholds

| Check | Threshold | Action |
|---|---|---|
| Restart count | > 5 | CRITICAL alert + auto-stop container |
| CPU usage | > 80% sustained | HIGH alert |
| Memory usage | > 90% of container limit | HIGH alert |
| Unexpected outbound IP | Not in allowlist | HIGH alert |

## Outbound Allowlist (Three Layers)

### Layer 1 — Built-in (hardcoded, applies to all containers)
| Category | Hosts |
|---|---|
| AI providers | api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, openrouter.ai, api.deepseek.com |
| Communication | api.telegram.org, discord.com |
| Web search | api.search.brave.com, api.tavily.com, serpapi.com, api.serper.dev, hn.algolia.com |
| Social | www.reddit.com, oauth.reddit.com, api.twitter.com, api.x.com |
| Email enrichment | api.hunter.io |
| Platform | supabase.co |

### Layer 2 — Admin extra-hosts file
File: `/etc/modelfitai/allowed-hosts.txt` — one hostname per line.

### Layer 3 — Per-container customer allowlist
Set via `ALLOWED_EXTRA_HOSTS` env var at deploy time.

## Environment Variables

- `TELEGRAM_BOT_TOKEN` — Telegram bot token for alerts
- `TELEGRAM_CHAT_ID` — Telegram chat ID to send alerts to
