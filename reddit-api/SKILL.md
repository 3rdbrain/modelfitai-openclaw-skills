---
name: reddit-api
description: Post, comment, reply, and manage content on Reddit via the Reddit OAuth2 API.
version: 1.0.0
author: ModelFitAI <skills@modelfitai.com>
license: MIT
keywords: [openclaw, skill, reddit, social-media, posting, oauth]
requires:
  env: [REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD]
---

# Reddit API Skill

Interact with Reddit directly using the Reddit OAuth2 API.

## Available Tools

Run with Node.js: `node {baseDir}/reddit-api.js <command> [args]`

- **post** — Submit a new post to a subreddit
- **comment** — Comment on a post
- **reply** — Reply to a comment
- **list** — List posts from a subreddit
- **delete** — Delete a post or comment

## Usage

```bash
node {baseDir}/reddit-api.js post --subreddit "test" --title "Title" --text "Body"
node {baseDir}/reddit-api.js comment <post_id> "Comment text"
node {baseDir}/reddit-api.js reply <comment_id> "Reply text"
```

## Environment Variables

- `REDDIT_CLIENT_ID` — Reddit app client ID
- `REDDIT_CLIENT_SECRET` — Reddit app client secret
- `REDDIT_USERNAME` — Reddit username
- `REDDIT_PASSWORD` — Reddit password
