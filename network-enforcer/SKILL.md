---
name: network-enforcer
description: Enforce iptables network isolation between Docker containers — blocks inter-container traffic and restricts outbound connections to approved hosts only.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, docker, iptables, network, isolation, security, vps]
requires: {}
---

# Network Enforcer Skill

Enforce hard network isolation between all OpenClaw customer containers using iptables.

## Available Commands

Run with Node.js: `node {baseDir}/network-enforcer.js <command>`

- **apply** — Apply all iptables DOCKER-USER rules (run at boot and after new container deploys)
- **verify** — Check that isolation rules are in place and intact
- **status** — Print the current DOCKER-USER chain rules
- **reset** — Remove all modelfitai iptables rules (emergency use only)
- **lock-ports** — Block public access to all control UI ports (18800-19000 range)
- **allow-inbound `<hostname|ip|cidr>`** — Allow a specific source to initiate NEW inbound connections
- **apply-inbound** — Re-apply saved inbound rules after a reboot
- **list-inbound** — Show all saved inbound allowlist entries and active iptables rules

## Usage

```bash
node {baseDir}/network-enforcer.js apply
node {baseDir}/network-enforcer.js verify
node {baseDir}/network-enforcer.js status
node {baseDir}/network-enforcer.js lock-ports
node {baseDir}/network-enforcer.js allow-inbound hooks.zapier.com
node {baseDir}/network-enforcer.js allow-inbound 34.120.50.0/24
node {baseDir}/network-enforcer.js list-inbound
```

## What It Enforces

1. Blocks all Docker bridge-to-bridge traffic (containers cannot reach each other)
2. Allows containers to reach the internet (external AI APIs, Telegram, Discord)
3. Blocks public access to ports 18800-19000 from non-localhost IPs
4. Blocks all unsolicited NEW inbound from the internet
5. Per-entry inbound exceptions via `/etc/modelfitai/allowed-inbound.txt`
