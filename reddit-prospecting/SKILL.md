---
name: reddit-prospecting
description: Find and engage potential leads on Reddit by monitoring subreddits and keywords.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, reddit, lead-gen, prospecting, sales]
requires:
  env: [REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD]
---

# Reddit Prospecting Skill

Find and engage potential leads on Reddit.

## Available Tools

Run with Node.js: `node {baseDir}/reddit-prospecting.js <command> [args]`

- **search** — Search Reddit posts by keyword
- **monitor** — Monitor a subreddit for relevant posts
- **engage** — Comment on a prospect's post
- **analyze** — Analyze a subreddit for lead potential

## Usage

```bash
node {baseDir}/reddit-prospecting.js search "need AI assistant"
node {baseDir}/reddit-prospecting.js monitor "r/startups"
node {baseDir}/reddit-prospecting.js engage <post_id> "Helpful comment"
```

## Environment Variables

- `REDDIT_CLIENT_ID` — Reddit app client ID
- `REDDIT_CLIENT_SECRET` — Reddit app client secret
- `REDDIT_USERNAME` — Reddit username
- `REDDIT_PASSWORD` — Reddit password
