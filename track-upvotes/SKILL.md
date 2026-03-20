---
name: track-upvotes
description: Track Product Hunt launch upvotes, comments, and daily ranking in real-time — get Telegram alerts when you move up the leaderboard.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, product-hunt, launch, tracking, upvotes, growth]
requires: {}
---

# Product Hunt Upvote Tracker Skill

Track your Product Hunt launch performance.

## Available Tools

Run with Node.js: `node {baseDir}/track-upvotes.js <command> [args]`

- **track** — Start tracking a Product Hunt post
- **status** — Get current upvote count and ranking
- **report** — Generate a performance summary

## Usage

```bash
node {baseDir}/track-upvotes.js track <product_hunt_url>
node {baseDir}/track-upvotes.js status
node {baseDir}/track-upvotes.js report
```
