---
name: security-updater
description: Auto-update OpenClaw agent containers with zero-downtime rolling updates — tags per-container rollback images and reverts automatically on failure.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, docker, updates, rollback, zero-downtime, vps, security]
requires:
  env: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID]
---

# Security Updater Skill

Keep the VPS host and all OpenClaw containers up to date automatically.

## Available Commands

Run with Node.js: `node {baseDir}/security-updater.js <command>`

- **check** — List available security updates (OS packages, Docker, OpenClaw image)
- **run** — Apply OS security-only patches (non-interactive, no reboot)
- **update-openclaw** — Pull latest OpenClaw image and do rolling restart of all containers
- **status** — Show last update run timestamp and result

## Usage

```bash
node {baseDir}/security-updater.js check
node {baseDir}/security-updater.js run
node {baseDir}/security-updater.js update-openclaw
node {baseDir}/security-updater.js status
```

## Update Strategy

1. **OS patches**: Security-only (`apt-get upgrade --security`), non-interactive
2. **Docker engine**: Upgrade if newer version available in apt
3. **OpenClaw image**: Pull latest, then rolling-restart containers one-by-one
4. **Health check**: Each container must pass healthcheck after update (60s window)
5. **Rollback**: If health check fails, previous image is restored for that container using per-container rollback tags

## Environment Variables

- `TELEGRAM_BOT_TOKEN` — Telegram bot token for update notifications
- `TELEGRAM_CHAT_ID` — Telegram chat ID to send notifications to
